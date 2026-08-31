# Image Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `uatu` into a gallery viewer for a directory of images, with a button that randomly rearranges them.

**Architecture:** A catalog module lists image files from a configured directory and caches the listing briefly. A pure seeded-shuffle module turns a seed into a deterministic permutation of that list. Routes render batches of 60 tiles; HTMX loads the next batch when a sentinel element scrolls into view, and the shuffle button re-requests batch zero with a fresh seed. A small vanilla-JS lightbox opens a native `<dialog>` for full-size viewing.

**Tech Stack:** Hono, Hono JSX, HTMX, Tailwind v4, Vitest, Node ≥22. **No new dependencies.**

## Why the shuffle must be seeded

This is the load-bearing decision. Infinite scroll requests batches separately: batch 0 is offset 0-59, batch 1 is offset 60-119. If "shuffle" were a per-request `Math.random()` reorder, each batch would be drawn from a *different* permutation, so images would repeat and others would never appear.

Instead, a seed is generated once, embedded in every batch URL, and used to derive the permutation deterministically. Same seed + same offset always yields the same slice. "Shuffle" means "pick a new seed and restart at offset 0."

Verified before writing this plan: `shuffled(['a'..'e'], 1)` yields `ecbad` on every call, `seed 2` yields `ceabd`, and the result is always a true permutation.

## Global Constraints

- Node `>=22`. Do not use APIs newer than Node 22.
- **No new runtime or dev dependencies.** Everything here uses what is installed.
- TypeScript `strict` plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Indexed access yields `T | undefined`; use `!` only where an invariant guarantees presence (as in the Fisher-Yates swap below).
- ESM with `module: nodenext`: **every relative import carries an explicit `.js` extension**, even though sources are `.ts`/`.tsx`.
- Files containing JSX must be `.tsx`.
- Tailwind only sees **literal** class strings. Never build class names by interpolation.
- Tests colocate as `*.test.ts` beside the code. Import from `vitest` explicitly; there are no globals.
- Tests must never read the real image directory. Use a temp fixture directory.
- Run `npm run typecheck && npm test` before every commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/gallery/shuffle.ts` | Seeded PRNG and permutation. Pure, no I/O. |
| `src/gallery/catalog.ts` | Reads the image directory, filters to image files, caches with a TTL, answers membership queries. |
| `src/config.ts` (modify) | Adds `imageDir`, expanding a leading `~/`. |
| `src/routes/images.ts` | `GET /images/:name` — serves one file, gated on catalog membership. |
| `src/routes/gallery.tsx` | `GET /` (page) and `GET /gallery` (batch fragment). |
| `src/views/Tile.tsx` | One image tile. |
| `src/views/GridBatch.tsx` | A batch of tiles plus the infinite-scroll sentinel. |
| `src/views/Gallery.tsx` | Page body: toolbar, grid container, lightbox dialog. |
| `public/lightbox.js` | ~50 lines of vanilla JS driving the `<dialog>` overlay. |
| `src/app.tsx` (modify) | Registers the new routers, drops the old `home` router. |

**Deliberate change to an existing convention.** Today `GET /` returns a bare fragment when `HX-Request` is set. The gallery instead puts partials on their own route (`/gallery`), which is the conventional HTMX shape and avoids one route serving two meanings. `renderPage` stays exactly as-is for pages and for the 404/500 handlers. Two existing tests in `src/app.test.ts` assert the old `/` fragment behavior and are rewritten in Task 6 — that is expected, not a regression.

---

### Task 1: Seeded shuffle

**Files:**
- Create: `src/gallery/shuffle.ts`
- Test: `src/gallery/shuffle.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeRng(seed: number): () => number`, `shuffled<T>(items: readonly T[], seed: number): T[]`, `randomSeed(): number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/gallery/shuffle.test.ts
import { describe, expect, it } from 'vitest'
import { randomSeed, shuffled } from './shuffle.js'

const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('shuffled', () => {
  it('is deterministic for a given seed', () => {
    expect(shuffled(base, 1)).toEqual(shuffled(base, 1))
  })

  it('produces different orders for different seeds', () => {
    expect(shuffled(base, 1)).not.toEqual(shuffled(base, 2))
  })

  it('is a true permutation -- nothing lost, nothing duplicated', () => {
    const out = shuffled(base, 99)
    expect([...out].sort()).toEqual([...base].sort())
    expect(out).toHaveLength(base.length)
  })

  it('does not mutate the input', () => {
    const copy = [...base]
    shuffled(base, 5)
    expect(base).toEqual(copy)
  })

  it('handles empty and single-element lists', () => {
    expect(shuffled([], 1)).toEqual([])
    expect(shuffled(['only'], 1)).toEqual(['only'])
  })

  it('actually reorders a large list', () => {
    const many = Array.from({ length: 500 }, (_, i) => String(i))
    expect(shuffled(many, 7)).not.toEqual(many)
  })
})

describe('randomSeed', () => {
  it('returns a non-negative 32-bit integer', () => {
    for (let i = 0; i < 50; i++) {
      const seed = randomSeed()
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(2 ** 32)
    }
  })

  it('varies across calls', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()))
    expect(seeds.size).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/gallery/shuffle.test.ts`
Expected: FAIL — `Failed to resolve import "./shuffle.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/gallery/shuffle.ts

/**
 * mulberry32: a small, fast, seedable PRNG. Chosen over Math.random because the
 * gallery needs the *same* permutation to be reproducible across separate batch
 * requests -- see "Why the shuffle must be seeded" in the plan.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, returning a new array. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = makeRng(seed)
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    // `!` is safe: i and j are both in [0, out.length).
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/gallery/shuffle.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/gallery/shuffle.ts src/gallery/shuffle.test.ts
git commit -m "Add seeded shuffle for stable gallery ordering"
```

---

### Task 2: Image catalog

**Files:**
- Create: `src/gallery/catalog.ts`
- Test: `src/gallery/catalog.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readCatalog(dir: string, nowMs?: number): Promise<Catalog>`, `clearCatalogCache(): void`, `CATALOG_TTL_MS: number`, and `interface Catalog { readonly names: readonly string[]; has(name: string): boolean }`.

`names` is sorted so a given seed yields the same order across restarts. `has` is what Task 4 uses to reject unknown paths.

- [ ] **Step 1: Write the failing test**

```ts
// src/gallery/catalog.test.ts
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CATALOG_TTL_MS, clearCatalogCache, readCatalog } from './catalog.js'

let dir: string

beforeEach(async () => {
  clearCatalogCache()
  dir = await mkdtemp(join(tmpdir(), 'uatu-catalog-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function touch(name: string): Promise<void> {
  await writeFile(join(dir, name), 'x')
}

describe('readCatalog', () => {
  it('lists image files in sorted order', async () => {
    await touch('b.webp')
    await touch('a.webp')
    await touch('c.png')

    const catalog = await readCatalog(dir)

    expect(catalog.names).toEqual(['a.webp', 'b.webp', 'c.png'])
  })

  it('ignores non-image files, including .DS_Store', async () => {
    await touch('keep.webp')
    await touch('.DS_Store')
    await touch('notes.txt')
    await touch('archive.zip')

    const catalog = await readCatalog(dir)

    expect(catalog.names).toEqual(['keep.webp'])
  })

  it('ignores subdirectories', async () => {
    await touch('keep.webp')
    await mkdir(join(dir, 'nested'))

    const catalog = await readCatalog(dir)

    expect(catalog.names).toEqual(['keep.webp'])
  })

  it('treats extensions case-insensitively', async () => {
    await touch('SHOUT.WEBP')

    const catalog = await readCatalog(dir)

    expect(catalog.names).toEqual(['SHOUT.WEBP'])
  })

  it('answers membership queries', async () => {
    await touch('known.webp')

    const catalog = await readCatalog(dir)

    expect(catalog.has('known.webp')).toBe(true)
    expect(catalog.has('unknown.webp')).toBe(false)
    expect(catalog.has('../../etc/passwd')).toBe(false)
  })

  it('serves from cache within the TTL', async () => {
    await touch('first.webp')
    await readCatalog(dir, 1000)

    await touch('second.webp')
    const cached = await readCatalog(dir, 1000 + CATALOG_TTL_MS - 1)

    expect(cached.names).toEqual(['first.webp'])
  })

  it('re-reads once the TTL has elapsed', async () => {
    await touch('first.webp')
    await readCatalog(dir, 1000)

    await touch('second.webp')
    const fresh = await readCatalog(dir, 1000 + CATALOG_TTL_MS + 1)

    expect(fresh.names).toEqual(['first.webp', 'second.webp'])
  })

  it('re-reads when the directory changes, ignoring the cache', async () => {
    await touch('a.webp')
    await readCatalog(dir, 1000)

    const other = await mkdtemp(join(tmpdir(), 'uatu-catalog-other-'))
    await writeFile(join(other, 'z.webp'), 'x')
    const second = await readCatalog(other, 1000)

    expect(second.names).toEqual(['z.webp'])
    await rm(other, { recursive: true, force: true })
  })

  it('throws a clear error when the directory does not exist', async () => {
    await expect(readCatalog(join(dir, 'nope'))).rejects.toThrow(/Cannot read image directory/)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/gallery/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/gallery/catalog.ts
import { readdir } from 'node:fs/promises'
import { extname } from 'node:path'

const IMAGE_EXTENSIONS = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif'])

/** How long a directory listing is reused before re-reading from disk. */
export const CATALOG_TTL_MS = 5000

export interface Catalog {
  readonly names: readonly string[]
  has(name: string): boolean
}

interface CacheEntry {
  readonly dir: string
  readonly at: number
  readonly catalog: Catalog
}

let cache: CacheEntry | null = null

/**
 * Lists image files in `dir`, sorted. Sorting matters: the shuffle derives its
 * permutation from index positions, so an unstable base order would change what a
 * given seed means between restarts.
 *
 * `nowMs` is injectable so cache expiry can be tested without waiting.
 */
export async function readCatalog(dir: string, nowMs: number = Date.now()): Promise<Catalog> {
  if (cache && cache.dir === dir && nowMs - cache.at < CATALOG_TTL_MS) {
    return cache.catalog
  }

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (cause) {
    throw new Error(`Cannot read image directory: ${dir}`, { cause })
  }

  const names = entries
    .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort()

  const lookup = new Set(names)
  const catalog: Catalog = { names, has: (name) => lookup.has(name) }

  cache = { dir, at: nowMs, catalog }
  return catalog
}

export function clearCatalogCache(): void {
  cache = null
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/gallery/catalog.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/gallery/catalog.ts src/gallery/catalog.test.ts
git commit -m "Add image catalog with TTL cache and membership lookup"
```

---

### Task 3: Configure the image directory

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Config.imageDir: string` (absolute), and `expandHome(raw: string, home: string): string`.

- [ ] **Step 1: Add the failing tests**

Append to `src/config.test.ts`:

```ts
describe('imageDir', () => {
  it('defaults to the documented source directory under the home directory', () => {
    const config = loadConfig({ HOME: '/home/someone' })

    expect(config.imageDir).toBe('/home/someone/Desktop/_stuff/_test/_source')
  })

  it('expands a leading ~/ in IMAGE_DIR', () => {
    const config = loadConfig({ HOME: '/home/someone', IMAGE_DIR: '~/pictures' })

    expect(config.imageDir).toBe('/home/someone/pictures')
  })

  it('accepts an absolute IMAGE_DIR unchanged', () => {
    const config = loadConfig({ HOME: '/home/someone', IMAGE_DIR: '/srv/images' })

    expect(config.imageDir).toBe('/srv/images')
  })

  it('rejects a relative IMAGE_DIR', () => {
    expect(() => loadConfig({ HOME: '/home/someone', IMAGE_DIR: 'images' })).toThrow(
      /Invalid IMAGE_DIR/,
    )
  })
})
```

Also update the existing "applies defaults for an empty environment" test, which uses `toEqual` and will now fail because `Config` has a new field. Change it to:

```ts
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({ HOME: '/home/someone' })).toEqual({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'development',
      isProduction: false,
      imageDir: '/home/someone/Desktop/_stuff/_test/_source',
    })
  })
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `imageDir` is undefined.

- [ ] **Step 3: Implement**

In `src/config.ts`, add `homedir` to the imports:

```ts
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
```

Add `imageDir` to the interface:

```ts
export interface Config {
  readonly port: number
  readonly host: string
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
  readonly imageDir: string
}
```

Add the constant and parser:

```ts
const DEFAULT_IMAGE_SUBPATH = 'Desktop/_stuff/_test/_source'

/** Expands a leading `~/`, which shells resolve but `process.env` hands over literally. */
export function expandHome(raw: string, home: string): string {
  return raw.startsWith('~/') ? `${home}/${raw.slice(2)}` : raw
}

function parseImageDir(raw: string | undefined, home: string): string {
  if (raw === undefined || raw === '') {
    return `${home}/${DEFAULT_IMAGE_SUBPATH}`
  }
  const expanded = expandHome(raw, home)
  if (!isAbsolute(expanded)) {
    throw new Error(
      `Invalid IMAGE_DIR: expected an absolute path or one starting with ~/, got ${JSON.stringify(raw)}`,
    )
  }
  return expanded
}
```

Wire it into `loadConfig`:

```ts
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const nodeEnv = parseNodeEnv(env.NODE_ENV)

  return {
    port: parsePort(env.PORT),
    host: env.HOST ?? '0.0.0.0',
    nodeEnv,
    isProduction: nodeEnv === 'production',
    imageDir: parseImageDir(env.IMAGE_DIR, env.HOME ?? homedir()),
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/config.ts src/config.test.ts
git commit -m "Add IMAGE_DIR configuration with ~ expansion"
```

---

### Task 4: Serve image files

**Files:**
- Create: `src/routes/images.ts`
- Test: `src/routes/images.test.ts`

**Interfaces:**
- Consumes: `readCatalog`, `clearCatalogCache` (Task 2); `config.imageDir` (Task 3).
- Produces: `images` — a `Hono` router mounted at `/`, serving `GET /images/:name`.

**Security note.** The route never joins user input onto a path until the name has been confirmed present in the catalog's `Set` of real basenames. A traversal attempt is not sanitized, it simply is not a member, so it 404s. Hono's `:name` parameter also does not match `/`.

- [ ] **Step 1: Write the failing test**

```ts
// src/routes/images.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCatalogCache } from '../gallery/catalog.js'

let dir: string

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
  return { ...actual, config: { ...actual.config, get imageDir() { return dir } } }
})

const { images } = await import('./images.js')

beforeEach(async () => {
  clearCatalogCache()
  dir = await mkdtemp(join(tmpdir(), 'uatu-images-'))
  await writeFile(join(dir, 'photo.webp'), 'fake-webp-bytes')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GET /images/:name', () => {
  it('serves a known image with the right content type', async () => {
    const res = await images.request('/images/photo.webp')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(await res.text()).toBe('fake-webp-bytes')
  })

  it('sets a caching header so re-shuffles reuse the browser cache', async () => {
    const res = await images.request('/images/photo.webp')

    expect(res.headers.get('cache-control')).toContain('max-age=')
  })

  it('404s for a name that is not in the catalog', async () => {
    const res = await images.request('/images/missing.webp')

    expect(res.status).toBe(404)
  })

  it('404s on traversal attempts rather than escaping the directory', async () => {
    for (const attempt of ['..%2F..%2Fetc%2Fpasswd', '.%2E%2Fsecret.webp', '%2Fetc%2Fpasswd']) {
      const res = await images.request(`/images/${attempt}`)
      expect(res.status).toBe(404)
    }
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/routes/images.test.ts`
Expected: FAIL — cannot resolve `./images.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/routes/images.ts
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import { config } from '../config.js'
import { readCatalog } from '../gallery/catalog.js'

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

export const images = new Hono()

images.get('/images/:name', async (c) => {
  const name = c.req.param('name')
  const catalog = await readCatalog(config.imageDir)

  // Membership in the catalog is the whole access check: only real basenames that
  // were actually listed from the directory can be served, so traversal attempts
  // fall through to 404 without any path sanitizing.
  if (!catalog.has(name)) {
    return c.notFound()
  }

  const bytes = await readFile(join(config.imageDir, name))
  const type = CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'

  return c.body(bytes, 200, {
    'Content-Type': type,
    // Shuffling re-renders every tile; caching keeps that from re-downloading.
    'Cache-Control': 'public, max-age=3600',
  })
})
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/routes/images.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/routes/images.ts src/routes/images.test.ts
git commit -m "Serve gallery images gated on catalog membership"
```

---

### Task 5: Tile and batch views

**Files:**
- Create: `src/views/Tile.tsx`
- Create: `src/views/GridBatch.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Tile(props: { name: string })` and `GridBatch(props: { names: readonly string[]; seed: number; nextOffset: number | null })`.

`nextOffset` is `null` when there are no further batches, which is how the sentinel stops recurring at the end of the list.

- [ ] **Step 1: Write the views**

```tsx
// src/views/Tile.tsx

/**
 * One image. `data-name` is the hook the lightbox uses to identify which image was
 * clicked without re-parsing the src.
 */
export function Tile(props: { name: string }) {
  return (
    <img
      src={`/images/${encodeURIComponent(props.name)}`}
      alt={props.name}
      data-name={props.name}
      loading="lazy"
      decoding="async"
      class="mb-3 w-full cursor-zoom-in rounded-lg break-inside-avoid bg-neutral-100 transition hover:opacity-90 dark:bg-neutral-800"
    />
  )
}
```

```tsx
// src/views/GridBatch.tsx
import { Tile } from './Tile.js'

/**
 * A batch of tiles, optionally followed by a sentinel. HTMX fires the sentinel's
 * request when it scrolls into view, and the response replaces the sentinel with the
 * next batch -- which carries its own sentinel, and so on until nextOffset is null.
 */
export function GridBatch(props: {
  names: readonly string[]
  seed: number
  nextOffset: number | null
}) {
  return (
    <>
      {props.names.map((name) => (
        <Tile key={name} name={name} />
      ))}
      {props.nextOffset !== null && (
        <div
          hx-get={`/gallery?seed=${props.seed}&offset=${props.nextOffset}`}
          hx-trigger="revealed"
          hx-swap="outerHTML"
          class="h-1 w-full"
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/Tile.tsx src/views/GridBatch.tsx
git commit -m "Add gallery tile and batch views"
```

---

### Task 6: Gallery page and batch routes

**Files:**
- Create: `src/views/Gallery.tsx`
- Create: `src/routes/gallery.tsx`
- Test: `src/routes/gallery.test.ts`
- Modify: `src/app.tsx`
- Modify: `src/app.test.ts`
- Delete: `src/routes/home.tsx`, `src/views/Home.tsx`

**Interfaces:**
- Consumes: `shuffled`, `randomSeed` (Task 1); `readCatalog` (Task 2); `config.imageDir` (Task 3); `GridBatch` (Task 5).
- Produces: `gallery` — a `Hono` router serving `GET /` and `GET /gallery`; `BATCH_SIZE = 60`.

- [ ] **Step 1: Write the failing test**

```ts
// src/routes/gallery.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCatalogCache } from '../gallery/catalog.js'

let dir: string

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
  return { ...actual, config: { ...actual.config, get imageDir() { return dir } } }
})

const { gallery, BATCH_SIZE } = await import('./gallery.js')

function countTiles(html: string): number {
  return (html.match(/<img /g) ?? []).length
}

function namesIn(html: string): string[] {
  return [...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]!)
}

beforeEach(async () => {
  clearCatalogCache()
  dir = await mkdtemp(join(tmpdir(), 'uatu-gallery-'))
  // 150 images: enough for three batches at BATCH_SIZE 60.
  for (let i = 0; i < 150; i++) {
    await writeFile(join(dir, `img-${String(i).padStart(3, '0')}.webp`), 'x')
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GET /', () => {
  it('renders a full page with the first batch', async () => {
    const res = await gallery.request('/')
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toContain('<!DOCTYPE html>')
    expect(countTiles(body)).toBe(BATCH_SIZE)
  })

  it('includes a shuffle control and a grid container', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="grid"')
    expect(body).toContain('hx-get="/gallery"')
  })

  it('includes a sentinel pointing at the next offset with a concrete seed', async () => {
    const body = await (await gallery.request('/')).text()
    const match = body.match(/\/gallery\?seed=(\d+)&amp;offset=(\d+)/)

    expect(match).not.toBeNull()
    expect(Number(match![2])).toBe(BATCH_SIZE)
  })
})

describe('GET /gallery', () => {
  it('returns a bare fragment, not a document', async () => {
    const body = await (await gallery.request('/gallery?seed=1&offset=0')).text()

    expect(body).not.toContain('<html')
    expect(body).not.toContain('<!DOCTYPE')
    expect(countTiles(body)).toBe(BATCH_SIZE)
  })

  it('returns the same slice for the same seed and offset', async () => {
    const a = await (await gallery.request('/gallery?seed=42&offset=60')).text()
    const b = await (await gallery.request('/gallery?seed=42&offset=60')).text()

    expect(namesIn(a)).toEqual(namesIn(b))
  })

  it('returns a different order for a different seed', async () => {
    const a = await (await gallery.request('/gallery?seed=1&offset=0')).text()
    const b = await (await gallery.request('/gallery?seed=2&offset=0')).text()

    expect(namesIn(a)).not.toEqual(namesIn(b))
  })

  it('never repeats an image across consecutive batches of one seed', async () => {
    const first = namesIn(await (await gallery.request('/gallery?seed=9&offset=0')).text())
    const second = namesIn(await (await gallery.request('/gallery?seed=9&offset=60')).text())

    expect(new Set([...first, ...second]).size).toBe(first.length + second.length)
  })

  it('covers every image across all batches without loss', async () => {
    const all: string[] = []
    for (let offset = 0; offset < 150; offset += BATCH_SIZE) {
      all.push(...namesIn(await (await gallery.request(`/gallery?seed=3&offset=${offset}`)).text()))
    }

    expect(new Set(all).size).toBe(150)
  })

  it('omits the sentinel on the final batch', async () => {
    const body = await (await gallery.request('/gallery?seed=1&offset=120')).text()

    expect(countTiles(body)).toBe(30)
    expect(body).not.toContain('hx-trigger="revealed"')
  })

  it('generates a fresh seed when none is given -- this is what the shuffle button does', async () => {
    const seeds = new Set<string>()
    for (let i = 0; i < 8; i++) {
      const body = await (await gallery.request('/gallery')).text()
      const match = body.match(/seed=(\d+)/)
      seeds.add(match![1]!)
    }

    expect(seeds.size).toBeGreaterThan(1)
  })

  it('falls back to a generated seed for a non-numeric one rather than erroring', async () => {
    const res = await gallery.request('/gallery?seed=notanumber&offset=0')

    expect(res.status).toBe(200)
    expect(countTiles(await res.text())).toBe(BATCH_SIZE)
  })

  it('returns an empty fragment for an offset past the end', async () => {
    const body = await (await gallery.request('/gallery?seed=1&offset=999')).text()

    expect(countTiles(body)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/routes/gallery.test.ts`
Expected: FAIL — cannot resolve `./gallery.js`.

- [ ] **Step 3: Write the view**

```tsx
// src/views/Gallery.tsx
import type { Child } from 'hono/jsx'

/**
 * The gallery page body. The grid is a CSS multi-column layout rather than a grid,
 * which lets tiles of differing heights pack without cropping or fixed aspect ratios.
 */
export function Gallery(props: { total: number; children?: Child }) {
  return (
    <main id="app" class="mx-auto max-w-7xl px-4 py-8">
      <header class="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">uatu</h1>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">{props.total} images</p>
        </div>
        <button
          type="button"
          hx-get="/gallery"
          hx-target="#grid"
          hx-swap="innerHTML"
          class="rounded-md border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark dark:hover:bg-accent-dark dark:hover:text-neutral-900"
        >
          Shuffle
        </button>
      </header>

      <div id="grid" class="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {props.children}
      </div>

      <dialog
        id="lightbox"
        class="backdrop:bg-black/80 m-auto max-h-[90vh] max-w-[90vw] bg-transparent p-0"
      >
        <img id="lightbox-image" alt="" class="max-h-[90vh] max-w-[90vw] rounded-lg" />
      </dialog>
    </main>
  )
}
```

- [ ] **Step 4: Write the routes**

```tsx
// src/routes/gallery.tsx
import { Hono } from 'hono'
import { config } from '../config.js'
import { readCatalog } from '../gallery/catalog.js'
import { randomSeed, shuffled } from '../gallery/shuffle.js'
import { renderPage } from '../render.js'
import { Gallery } from '../views/Gallery.js'
import { GridBatch } from '../views/GridBatch.js'

/** Images per batch. Small enough for a fast first paint, large enough to fill a screen. */
export const BATCH_SIZE = 60

export const gallery = new Hono()

/**
 * A missing or malformed seed becomes a fresh one rather than an error: the shuffle
 * button deliberately requests /gallery with no seed to mean "give me a new order".
 */
function seedFrom(raw: string | undefined): number {
  if (raw === undefined) return randomSeed()
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : randomSeed()
}

function offsetFrom(raw: string | undefined): number {
  const parsed = Number(raw ?? 0)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

async function batch(seed: number, offset: number) {
  const catalog = await readCatalog(config.imageDir)
  const order = shuffled(catalog.names, seed)
  const names = order.slice(offset, offset + BATCH_SIZE)
  const nextOffset = offset + BATCH_SIZE < order.length ? offset + BATCH_SIZE : null

  return { names, nextOffset, total: order.length }
}

gallery.get('/', async (c) => {
  const seed = randomSeed()
  const { names, nextOffset, total } = await batch(seed, 0)

  return renderPage(
    c,
    'uatu',
    <Gallery total={total}>
      <GridBatch names={names} seed={seed} nextOffset={nextOffset} />
    </Gallery>,
  )
})

gallery.get('/gallery', async (c) => {
  const seed = seedFrom(c.req.query('seed'))
  const offset = offsetFrom(c.req.query('offset'))
  const { names, nextOffset } = await batch(seed, offset)

  return c.html(<GridBatch names={names} seed={seed} nextOffset={nextOffset} />)
})
```

- [ ] **Step 5: Wire into the app and remove the old home route**

In `src/app.tsx`, replace the `home` import and registration:

```tsx
import { gallery } from './routes/gallery.js'
import { images } from './routes/images.js'
```

```tsx
app.route('/', health)
app.route('/', images)
app.route('/', gallery)
```

Delete the now-unused files:

```bash
git rm src/routes/home.tsx src/views/Home.tsx
```

- [ ] **Step 6: Update the app tests**

In `src/app.test.ts`, the two `GET /` tests assert the old placeholder page and the old `/` fragment behavior. Replace the whole `describe('GET /')` block with:

```ts
describe('GET /', () => {
  it('serves the gallery page', async () => {
    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const body = await res.text()
    expect(body).toContain('<!DOCTYPE html>')
    expect(body).toContain('id="grid"')
  })
})
```

The 404 tests stay as they are — `renderPage` still drives the error paths, so the HTMX fragment branch is still covered there.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npx vitest run`
Expected: PASS. `src/app.test.ts` will exercise the real `config.imageDir`, so this requires the actual image directory to exist. If it does not, the 404 tests still pass and only the gallery page test fails — that is the signal that `IMAGE_DIR` is misconfigured.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add gallery page with seeded shuffle and HTMX infinite scroll"
```

---

### Task 7: Lightbox

**Files:**
- Create: `public/lightbox.js`
- Modify: `src/views/Layout.tsx`
- Test: `src/routes/gallery.test.ts` (append)

**Interfaces:**
- Consumes: the `#lightbox`, `#lightbox-image`, `#grid` ids and `img[data-name]` from Tasks 5-6.
- Produces: no module exports; a script the page loads.

**Testing limitation, stated plainly.** Vitest has no DOM here and adding `jsdom`/`happy-dom` would break the no-new-dependencies constraint. So the tests below verify the *markup contract* the script depends on — the dialog, the image element, the `data-name` hooks. The interactive behavior itself needs a manual browser check, which Step 5 spells out. Do not claim the lightbox is verified on the strength of these tests alone.

- [ ] **Step 1: Write the failing markup-contract test**

Append to `src/routes/gallery.test.ts`:

```ts
describe('lightbox markup contract', () => {
  it('renders the dialog and its image element', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="lightbox"')
    expect(body).toContain('id="lightbox-image"')
  })

  it('gives every tile a data-name for the lightbox to read', async () => {
    const body = await (await gallery.request('/')).text()
    const tiles = (body.match(/<img /g) ?? []).length
    const named = (body.match(/data-name="/g) ?? []).length

    // The lightbox's own <img> has no data-name, hence the off-by-one.
    expect(named).toBe(tiles - 1)
  })
})
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/routes/gallery.test.ts -t 'lightbox'`
Expected: PASS. Unlike the other tasks these are not red-first — Task 6 already produced the markup they assert. They exist as regression guards, so that a later change to the views cannot silently break the contract `lightbox.js` depends on. If either one fails here, Task 6 was not completed as written; fix that before continuing.

- [ ] **Step 3: Write the script**

```js
// public/lightbox.js
// Opens a full-size overlay when a tile is clicked. Plain DOM, no framework:
// the page has no bundler, so this ships as-is.
(function () {
  const dialog = document.getElementById('lightbox')
  const image = document.getElementById('lightbox-image')
  if (!dialog || !image) return

  // Index into the tiles as they currently appear. Recomputed on each open because
  // HTMX replaces the grid contents on shuffle and appends on scroll.
  let tiles = []
  let current = -1

  function show(index) {
    if (index < 0 || index >= tiles.length) return
    current = index
    const tile = tiles[current]
    image.src = tile.src
    image.alt = tile.alt
  }

  // Delegated from document, so tiles added by HTMX after load still work.
  document.addEventListener('click', function (event) {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || !target.dataset.name) return

    tiles = Array.from(document.querySelectorAll('#grid img[data-name]'))
    show(tiles.indexOf(target))
    dialog.showModal()
  })

  document.addEventListener('keydown', function (event) {
    if (!dialog.open) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      show(current + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      show(current - 1)
    }
  })

  // Clicking the backdrop closes; clicking the image itself does not.
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) dialog.close()
  })
})()
```

- [ ] **Step 4: Load it from the layout**

In `src/views/Layout.tsx`, add a second script tag below the htmx one:

```tsx
          <script src="/static/vendor/htmx.min.js" defer></script>
          <script src="/static/lightbox.js" defer></script>
```

- [ ] **Step 5: Verify manually in a browser**

```bash
npm run dev
```

Open http://localhost:3000 and confirm all five:
1. The grid renders and images load.
2. Scrolling to the bottom appends more images without a page reload.
3. Clicking an image opens the overlay at full size.
4. Left/right arrow keys move between images; Escape closes the overlay.
5. Clicking Shuffle reorders the grid and scrolling still loads more, without repeats.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx vitest run
git add -A
git commit -m "Add click-to-enlarge lightbox"
```

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/designs/design.md` (track it — it is currently untracked)

- [ ] **Step 1: Document the feature in the README**

Add an `IMAGE_DIR` row to the configuration table:

```markdown
| `IMAGE_DIR` | `~/Desktop/_stuff/_test/_source` | Absolute path, or one starting with `~/` |
```

Add a section after Styling:

```markdown
## Gallery

The app serves a shuffle-able grid of images read from `IMAGE_DIR`.

**The shuffle is seeded, not random per request.** Infinite scroll fetches batches
separately, so a per-request reorder would repeat some images and omit others. Instead a
seed is generated once, embedded in every batch URL, and turned into a permutation by
`src/gallery/shuffle.ts`. Same seed plus same offset always yields the same slice, and
"shuffle" means "new seed, restart at offset 0".

Routes:

| Route | Purpose |
| --- | --- |
| `GET /` | Gallery page with the first batch |
| `GET /gallery?seed=&offset=` | Batch fragment; omit `seed` to get a fresh order |
| `GET /images/:name` | One image file |

`/images/:name` serves a file only if the name is present in the catalog listing, so
traversal attempts 404 rather than being sanitized.

Partials live on their own routes rather than being branched out of `/` by the
`HX-Request` header. `renderPage` still uses that header for pages and error responses.
```

- [ ] **Step 2: Track the design document**

```bash
git add docs/designs/design.md
```

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npx vitest run
rm -rf dist public/app.css && npm run build
PORT=3113 node dist/server.js &
sleep 1
curl -s -o /dev/null -w 'page: %{http_code}\n' http://127.0.0.1:3113/
curl -s -o /dev/null -w 'batch: %{http_code}\n' 'http://127.0.0.1:3113/gallery?seed=1&offset=60'
curl -s 'http://127.0.0.1:3113/' | grep -o 'data-name="[^"]*"' | head -1
kill %1
```

Expected: typecheck clean, all tests pass, build succeeds, both routes return 200, and a real filename appears.

- [ ] **Step 4: Commit and open a PR**

```bash
git add -A
git commit -m "Document the gallery feature"
git push -u origin feat/gallery
gh pr create --base main --title "Add image gallery with seeded shuffle"
```

`main` requires `test (node 22)`, `test (node 24)`, and `docker build` to pass.

---

## Risks

**CI has no image directory.** GitHub Actions runners have no `~/Desktop/_stuff/_test/_source`, so `readCatalog` will throw there and any test touching the real config will fail. Tasks 4 and 6 mock `../config.js` to point at a temp directory, which covers the gallery route tests — but `src/app.test.ts` imports the real `app` and hits the real config on `GET /`. **If that test fails in CI, the fix is to mock the config in `app.test.ts` the same way, not to weaken the assertion.** Watch for this on the first CI run.

**The 1,249 images are not in the repo,** and should not be. Every automated test builds its own fixture directory.

**`columns-*` reflow on shuffle.** CSS multi-column recomputes layout when the grid's contents are replaced, which can look like a jump on slower machines. Acceptable for now; if it grates, the fix is a fixed-aspect grid instead of columns.
