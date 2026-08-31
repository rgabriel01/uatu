# Tag Filtering Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users narrow the gallery to images carrying *all* of a chosen set of tags, with the filter reflected in the page URL.

**Architecture:** A single SQL query returns the image names carrying every selected tag. The gallery route intersects that set with the on-disk catalog **before** shuffling, so the permutation is over the filtered list. Selected tags ride in every batch URL alongside the seed. A chip bar above the grid toggles tags and pushes the URL.

**Tech Stack:** Hono, Hono JSX, HTMX, Tailwind v4, `node:sqlite`, Vitest, Node ≥24. **No new dependencies.**

## The two decisions that drive everything

**1. Filter before shuffle.** The seed permutes a list; if the list is the whole catalog and filtering happens afterwards, each batch is a slice of the *unfiltered* permutation and filtering would drop items unevenly across batches. Filtering first makes the permutation a permutation of the filtered set, so offsets stay meaningful.

**2. Tags ride in every batch URL.** Same lesson as the seed. The infinite-scroll sentinel fetches `/gallery?seed=…&offset=60`; without the tags on that URL, batch 2 comes from the unfiltered catalog. It would look correct on the first screen and be wrong on the second — exactly the failure the seeded shuffle was designed to avoid.

## AND semantics, and the duplicate-tag trap

"Further filters" means AND: each added tag narrows the set.

```sql
SELECT image_tag.image_name AS n
  FROM image_tag
  JOIN tag ON tag.id = image_tag.tag_id
 WHERE tag.name IN (?, ?, ...)
 GROUP BY image_tag.image_name
HAVING COUNT(DISTINCT tag.id) = ?
```

Verified before writing this plan:

| Input | Result |
| --- | --- |
| `[red-birds]` | `a.webp`, `b.webp` |
| `[red-birds, great-images]` | `a.webp` only — AND, not OR |
| `[nope]` | empty |
| `[red-birds, nope]` | empty — correct for AND |
| `[red-birds, red-birds]` | **empty — wrong** |

That last row is a real bug in the naive version. A repeated tag makes the bound count 2 while `COUNT(DISTINCT tag.id)` is 1, so a legitimate filter returns nothing. `?tag=red-birds&tag=red-birds` is trivially producible by hand or by a double-click. **The input must be deduplicated before the query.**

## Global Constraints

- Node `>=24`. **No new dependencies.**
- TypeScript `strict` plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- Relative imports carry explicit `.js` extensions; JSX files are `.tsx`.
- Tailwind only sees **literal** class strings.
- Tests colocate as `*.test.ts`, import from `vitest` explicitly, and use an in-memory database plus a temp image directory.
- **Verify with explicit exit codes.** `npm run typecheck && echo PASS` hides failures under `set -e`, because `set -e` ignores a failing left-hand side of `&&`. Run `npm run typecheck; echo "exit: $?"` instead.
- Run `npm run typecheck` and `npx vitest run` before every commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tags/store.ts` (modify) | Adds `imageNamesWithAllTags` |
| `src/gallery/filter.ts` | Parses, normalizes, dedupes, and serializes tag selections |
| `src/views/TagFilterBar.tsx` | Chip bar plus the result count |
| `src/views/Gallery.tsx` (modify) | Adds the `#gallery-body` wrapper; count moves into the filter bar |
| `src/routes/gallery.tsx` (modify) | Accepts `tag` params; adds `GET /gallery/view` |

**Why the count moves.** With a filter applied, "1249 images" in the header is wrong. Everything that changes with the filter — the chips and the count — moves inside one swappable `#gallery-body` fragment, so a single swap keeps them consistent. The header keeps only the title, cog, and Shuffle.

---

### Task 1: The AND query

**Files:**
- Modify: `src/tags/store.ts`
- Modify: `src/tags/store.test.ts`

**Interfaces:**
- Produces: `imageNamesWithAllTags(db: DatabaseSync, tagNames: readonly string[]): Set<string>`.

Callers must not pass an empty list — an empty selection means "no filter", which is the caller's business, not this function's. The empty case returns an empty set and is pinned by a test so the behaviour is explicit rather than accidental.

- [ ] **Step 1: Write the failing test**

Append to `src/tags/store.test.ts`, and add `imageNamesWithAllTags` to the import list:

```ts
describe('imageNamesWithAllTags', () => {
  beforeEach(() => {
    const red = createTag(db, 'red-birds')
    const great = createTag(db, 'great-images')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', great.id)
    addTagToImage(db, 'b.webp', red.id)
    addTagToImage(db, 'c.webp', great.id)
    addTagToImage(db, 'c.webp', blue.id)
  })

  it('returns every image carrying a single tag', () => {
    expect([...imageNamesWithAllTags(db, ['red-birds'])].sort()).toEqual(['a.webp', 'b.webp'])
  })

  it('requires ALL tags, not any -- this is AND, not OR', () => {
    expect([...imageNamesWithAllTags(db, ['red-birds', 'great-images'])]).toEqual(['a.webp'])
  })

  it('narrows further with each additional tag', () => {
    const one = imageNamesWithAllTags(db, ['great-images'])
    const two = imageNamesWithAllTags(db, ['great-images', 'blue-sky'])

    expect(one.size).toBe(2)
    expect(two.size).toBe(1)
  })

  it('returns nothing for an unknown tag', () => {
    expect(imageNamesWithAllTags(db, ['nope']).size).toBe(0)
  })

  it('returns nothing when one of several tags is unknown', () => {
    expect(imageNamesWithAllTags(db, ['red-birds', 'nope']).size).toBe(0)
  })

  it('ignores a repeated tag rather than returning nothing', () => {
    // A naive HAVING COUNT(...) = ? compares against the number of bound
    // parameters, so a duplicate silently breaks a legitimate filter.
    expect([...imageNamesWithAllTags(db, ['red-birds', 'red-birds'])].sort()).toEqual([
      'a.webp',
      'b.webp',
    ])
  })

  it('returns an empty set for an empty selection -- callers must skip instead', () => {
    expect(imageNamesWithAllTags(db, []).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run and confirm the duplicate and AND cases fail**

Run: `npx vitest run src/tags/store.test.ts -t 'imageNamesWithAllTags'`
Expected: FAIL — `imageNamesWithAllTags is not a function`.

- [ ] **Step 3: Implement**

Add to `src/tags/store.ts`:

```ts
/**
 * Image names carrying EVERY one of `tagNames` (AND, not OR).
 *
 * The names are deduplicated first: HAVING compares against the number of distinct
 * matched tags, so passing the same tag twice would make the required count exceed
 * what any image can satisfy and silently return nothing.
 *
 * An empty selection yields an empty set. Callers wanting "no filter" must skip this
 * call rather than pass an empty list.
 */
export function imageNamesWithAllTags(
  db: DatabaseSync,
  tagNames: readonly string[],
): Set<string> {
  const unique = [...new Set(tagNames)]
  if (unique.length === 0) {
    return new Set()
  }

  const placeholders = unique.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT image_tag.image_name AS name
         FROM image_tag
         JOIN tag ON tag.id = image_tag.tag_id
        WHERE tag.name IN (${placeholders})
        GROUP BY image_tag.image_name
       HAVING COUNT(DISTINCT tag.id) = ?`,
    )
    .all(...unique, unique.length) as unknown as { name: string }[]

  return new Set(rows.map((row) => row.name))
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tags/store.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck; echo "exit: $?"
npx vitest run
git add src/tags/store.ts src/tags/store.test.ts
git commit -m "Add AND-semantics tag filter query"
```

---

### Task 2: Selection parsing

**Files:**
- Create: `src/gallery/filter.ts`
- Test: `src/gallery/filter.test.ts`

**Interfaces:**
- Produces: `parseTagSelection(raw: readonly string[]): string[]` (normalized, deduped, sorted) and `buildGalleryQuery(params: { seed?: number; offset?: number; tags: readonly string[] }): string`.

Sorting makes URLs stable, so `?tag=b&tag=a` and `?tag=a&tag=b` are the same page.

- [ ] **Step 1: Write the failing test**

```ts
// src/gallery/filter.test.ts
import { describe, expect, it } from 'vitest'
import { buildGalleryQuery, parseTagSelection } from './filter.js'

describe('parseTagSelection', () => {
  it('keeps valid tag names', () => {
    expect(parseTagSelection(['red-birds', 'great-images'])).toEqual([
      'great-images',
      'red-birds',
    ])
  })

  it('sorts so URLs are stable regardless of click order', () => {
    expect(parseTagSelection(['zebra', 'apple'])).toEqual(parseTagSelection(['apple', 'zebra']))
  })

  it('deduplicates', () => {
    expect(parseTagSelection(['red-birds', 'red-birds'])).toEqual(['red-birds'])
  })

  it('normalizes case and surrounding space', () => {
    expect(parseTagSelection([' Red-Birds '])).toEqual(['red-birds'])
  })

  it('drops names that could never be a tag', () => {
    expect(parseTagSelection(['red birds', '', 'ok-tag'])).toEqual(['ok-tag'])
  })

  it('returns an empty array for no input', () => {
    expect(parseTagSelection([])).toEqual([])
  })
})

describe('buildGalleryQuery', () => {
  it('includes seed and offset', () => {
    expect(buildGalleryQuery({ seed: 7, offset: 60, tags: [] })).toBe('seed=7&offset=60')
  })

  it('appends each tag as a repeated parameter', () => {
    expect(buildGalleryQuery({ seed: 7, offset: 0, tags: ['apple', 'zebra'] })).toBe(
      'seed=7&offset=0&tag=apple&tag=zebra',
    )
  })

  it('omits seed and offset when not given', () => {
    expect(buildGalleryQuery({ tags: ['apple'] })).toBe('tag=apple')
  })

  it('returns an empty string when there is nothing to encode', () => {
    expect(buildGalleryQuery({ tags: [] })).toBe('')
  })

  it('escapes tag names', () => {
    expect(buildGalleryQuery({ tags: ['a-b'] })).toBe('tag=a-b')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/gallery/filter.test.ts`
Expected: FAIL — cannot resolve `./filter.js`.

- [ ] **Step 3: Implement**

```ts
// src/gallery/filter.ts
import { normalizeTagName, tagNameError } from '../tags/name.js'

/**
 * Normalizes, drops anything that could not be a tag, deduplicates, and sorts.
 *
 * Sorting keeps URLs stable so the same selection is always the same page, and
 * deduplication protects the AND query, whose HAVING count would otherwise never be
 * satisfiable when a tag is repeated.
 */
export function parseTagSelection(raw: readonly string[]): string[] {
  const names = raw.map(normalizeTagName).filter((name) => tagNameError(name) === null)
  return [...new Set(names)].sort()
}

export function buildGalleryQuery(params: {
  seed?: number
  offset?: number
  tags: readonly string[]
}): string {
  const parts: string[] = []
  if (params.seed !== undefined) parts.push(`seed=${params.seed}`)
  if (params.offset !== undefined) parts.push(`offset=${params.offset}`)
  for (const tag of params.tags) parts.push(`tag=${encodeURIComponent(tag)}`)
  return parts.join('&')
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/gallery/filter.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck; echo "exit: $?"
git add src/gallery/filter.ts src/gallery/filter.test.ts
git commit -m "Add tag selection parsing and query building"
```

---

### Task 3: Filter bar view

**Files:**
- Create: `src/views/TagFilterBar.tsx`

**Interfaces:**
- Produces: `TagFilterBar(props: { allTags: readonly Tag[]; activeTags: readonly string[]; matchCount: number; seed: number })`.

Each chip toggles its own tag: an active chip links to the selection minus itself, an inactive one to the selection plus itself. Chips swap `#gallery-body` and push the corresponding page URL.

- [ ] **Step 1: Write the view**

```tsx
// src/views/TagFilterBar.tsx
import { buildGalleryQuery } from '../gallery/filter.js'
import type { Tag } from '../tags/store.js'

function toggled(active: readonly string[], name: string): string[] {
  return active.includes(name)
    ? active.filter((t) => t !== name)
    : [...active, name].sort()
}

/**
 * Chip bar plus the result count. Lives inside #gallery-body with the grid, so one
 * swap keeps the chips, the count, and the images consistent with each other.
 */
export function TagFilterBar(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  matchCount: number
  seed: number
}) {
  const active = props.activeTags

  return (
    <div class="mb-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        {props.allTags.map((tag) => {
          const next = toggled(active, tag.name)
          const isActive = active.includes(tag.name)
          return (
            <button
              key={tag.id}
              type="button"
              hx-get={`/gallery/view?${buildGalleryQuery({ seed: props.seed, tags: next })}`}
              hx-target="#gallery-body"
              hx-swap="outerHTML"
              hx-push-url={`/?${buildGalleryQuery({ tags: next })}`}
              aria-pressed={isActive ? 'true' : 'false'}
              class={
                isActive
                  ? 'rounded-full border border-accent bg-accent px-3 py-1 text-sm text-white dark:border-accent-dark dark:bg-accent-dark dark:text-neutral-900'
                  : 'rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
              }
            >
              {tag.name}
            </button>
          )
        })}

        {active.length > 0 && (
          <button
            type="button"
            id="clear-filter"
            hx-get={`/gallery/view?${buildGalleryQuery({ seed: props.seed, tags: [] })}`}
            hx-target="#gallery-body"
            hx-swap="outerHTML"
            hx-push-url="/"
            class="rounded-full px-3 py-1 text-sm text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Clear
          </button>
        )}
      </div>

      <p id="result-count" class="text-sm text-neutral-500 dark:text-neutral-400">
        {props.matchCount} images
        {active.length > 0 && ` matching ${active.length} ${active.length === 1 ? 'tag' : 'tags'}`}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck; echo "exit: $?"`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/views/TagFilterBar.tsx
git commit -m "Add tag filter chip bar"
```

---

### Task 4: Filtered gallery routes

**Files:**
- Modify: `src/routes/gallery.tsx`, `src/views/Gallery.tsx`
- Modify: `src/routes/gallery.test.ts`

**Interfaces:**
- Produces: `createGalleryRoutes(getDb: () => DatabaseSync): Hono` serving `GET /`, `GET /gallery/view`, `GET /gallery`; `gallery` stays exported, bound to `getDatabase`.

The database is injected for the same reason as the tag routes — tests supply an in-memory one.

- [ ] **Step 1: Write the failing tests**

Replace the top of `src/routes/gallery.test.ts` so it builds the router with an in-memory database, keeping the existing `vi.mock` for the image directory:

```ts
import { openDatabase } from '../db/index.js'
import { addTagToImage, createTag } from '../tags/store.js'

const { createGalleryRoutes, BATCH_SIZE } = await import('./gallery.js')

let tagDb: ReturnType<typeof openDatabase>
let gallery: ReturnType<typeof createGalleryRoutes>
```

and inside the existing `beforeEach`, after the image fixtures are written:

```ts
  tagDb = openDatabase(':memory:')
  gallery = createGalleryRoutes(() => tagDb)
```

Then append:

```ts
describe('filtering by tag', () => {
  function tagImages(tagName: string, images: readonly string[]): void {
    const tag = createTag(tagDb, tagName)
    for (const image of images) addTagToImage(tagDb, image, tag.id)
  }

  it('narrows the grid to images carrying the tag', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp', 'img-002.webp'])

    const body = await (await gallery.request('/gallery?tag=red-birds&seed=1&offset=0')).text()

    expect(countTiles(body)).toBe(3)
    expect(namesIn(body).sort()).toEqual(['img-000.webp', 'img-001.webp', 'img-002.webp'])
  })

  it('narrows further with a second tag -- AND, not OR', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp', 'img-002.webp'])
    tagImages('great-images', ['img-002.webp', 'img-003.webp'])

    const body = await (
      await gallery.request('/gallery?tag=red-birds&tag=great-images&seed=1&offset=0')
    ).text()

    expect(namesIn(body)).toEqual(['img-002.webp'])
  })

  it('keeps the filter across batches -- the regression this design exists to prevent', async () => {
    const many = Array.from({ length: 90 }, (_, i) => `img-${String(i).padStart(3, '0')}.webp`)
    tagImages('many', many)

    const first = namesIn(await (await gallery.request('/gallery?tag=many&seed=5&offset=0')).text())
    const second = namesIn(
      await (await gallery.request('/gallery?tag=many&seed=5&offset=60')).text(),
    )

    expect(first).toHaveLength(BATCH_SIZE)
    expect(second).toHaveLength(30)
    // Every image in both batches must be one of the tagged ones.
    for (const name of [...first, ...second]) expect(many).toContain(name)
    // And no repeats across batches.
    expect(new Set([...first, ...second]).size).toBe(90)
  })

  it('carries the tags on the sentinel URL', async () => {
    const many = Array.from({ length: 90 }, (_, i) => `img-${String(i).padStart(3, '0')}.webp`)
    tagImages('many', many)

    const body = await (await gallery.request('/gallery?tag=many&seed=5&offset=0')).text()

    expect(body).toContain('tag=many')
    expect(body).toContain('offset=60')
  })

  it('is stable for the same seed and filter', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp', 'img-002.webp'])

    const a = await (await gallery.request('/gallery?tag=red-birds&seed=3&offset=0')).text()
    const b = await (await gallery.request('/gallery?tag=red-birds&seed=3&offset=0')).text()

    expect(namesIn(a)).toEqual(namesIn(b))
  })

  it('returns nothing for a tag no image carries', async () => {
    createTag(tagDb, 'unused')

    const body = await (await gallery.request('/gallery?tag=unused&seed=1&offset=0')).text()

    expect(countTiles(body)).toBe(0)
  })

  it('ignores a repeated tag rather than emptying the result', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp'])

    const body = await (
      await gallery.request('/gallery?tag=red-birds&tag=red-birds&seed=1&offset=0')
    ).text()

    expect(countTiles(body)).toBe(2)
  })

  it('shows every image when no tag is selected', async () => {
    tagImages('red-birds', ['img-000.webp'])

    const body = await (await gallery.request('/gallery?seed=1&offset=0')).text()

    expect(countTiles(body)).toBe(BATCH_SIZE)
  })
})

describe('GET /gallery/view', () => {
  it('returns the gallery body with chips and a count', async () => {
    createTag(tagDb, 'red-birds')

    const body = await (await gallery.request('/gallery/view?seed=1')).text()

    expect(body).toContain('id="gallery-body"')
    expect(body).toContain('id="result-count"')
    expect(body).toContain('red-birds')
    expect(body).not.toContain('<html')
  })

  it('reports the filtered count, not the total', async () => {
    const tag = createTag(tagDb, 'red-birds')
    addTagToImage(tagDb, 'img-000.webp', tag.id)
    addTagToImage(tagDb, 'img-001.webp', tag.id)

    const body = await (await gallery.request('/gallery/view?tag=red-birds&seed=1')).text()

    expect(body).toMatch(/2 images/)
  })
})

describe('GET / with a filter', () => {
  it('applies tags from the page URL', async () => {
    const tag = createTag(tagDb, 'red-birds')
    addTagToImage(tagDb, 'img-000.webp', tag.id)

    const body = await (await gallery.request('/?tag=red-birds')).text()

    expect(body).toContain('<!DOCTYPE html>')
    expect(countTiles(body)).toBe(1)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/routes/gallery.test.ts`
Expected: FAIL — `createGalleryRoutes` is not exported.

- [ ] **Step 3: Restructure the Gallery view**

In `src/views/Gallery.tsx`, remove the count paragraph from the header (the `{props.total} images` line and its wrapper `<p>`), drop the `total` prop, and wrap the grid in `#gallery-body`. The header keeps title, cog, and Shuffle; the Shuffle button gains the active tags so shuffling preserves the filter:

```tsx
export function Gallery(props: { activeTags: readonly string[]; children?: Child }) {
```

Replace the Shuffle button's `hx-get` and target with:

```tsx
            hx-get={`/gallery/view?${buildGalleryQuery({ tags: props.activeTags })}`}
            hx-target="#gallery-body"
            hx-swap="outerHTML"
```

Replace the grid `<div>` with:

```tsx
      <div id="gallery-body">{props.children}</div>
```

Add the import:

```tsx
import { buildGalleryQuery } from '../gallery/filter.js'
```

- [ ] **Step 4: Add a body view**

Create `src/views/GalleryBody.tsx`:

```tsx
import type { Child } from 'hono/jsx'
import type { Tag } from '../tags/store.js'
import { TagFilterBar } from './TagFilterBar.js'

/**
 * Everything that changes when the filter changes: the chips, the count, and the
 * grid. Swapped as one unit so they can never disagree.
 */
export function GalleryBody(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  matchCount: number
  seed: number
  children?: Child
}) {
  return (
    <div id="gallery-body">
      <TagFilterBar
        allTags={props.allTags}
        activeTags={props.activeTags}
        matchCount={props.matchCount}
        seed={props.seed}
      />
      <div id="grid" class="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {props.children}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite the routes**

Replace `src/routes/gallery.tsx` with:

```tsx
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { config } from '../config.js'
import { readCatalog } from '../gallery/catalog.js'
import { parseTagSelection } from '../gallery/filter.js'
import { randomSeed, shuffled } from '../gallery/shuffle.js'
import { getDatabase } from '../db/index.js'
import { renderPage } from '../render.js'
import { imageNamesWithAllTags, listTags } from '../tags/store.js'
import { Gallery } from '../views/Gallery.js'
import { GalleryBody } from '../views/GalleryBody.js'
import { GridBatch } from '../views/GridBatch.js'

/** Images per batch. Small enough for a fast first paint, large enough to fill a screen. */
export const BATCH_SIZE = 60

function seedFrom(raw: string | undefined): number {
  if (raw === undefined) return randomSeed()
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : randomSeed()
}

function offsetFrom(raw: string | undefined): number {
  const parsed = Number(raw ?? 0)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function createGalleryRoutes(getDb: () => DatabaseSync): Hono {
  const app = new Hono()

  /**
   * Filtering happens BEFORE shuffling so the permutation is over the filtered list.
   * Shuffling first and filtering after would make each batch an uneven slice of the
   * unfiltered order.
   */
  async function select(seed: number, tags: readonly string[]) {
    const catalog = await readCatalog(config.imageDir)

    let names: readonly string[] = catalog.names
    if (tags.length > 0) {
      const allowed = imageNamesWithAllTags(getDb(), tags)
      names = names.filter((name) => allowed.has(name))
    }

    return shuffled(names, seed)
  }

  function batchOf(order: readonly string[], offset: number) {
    return {
      names: order.slice(offset, offset + BATCH_SIZE),
      nextOffset: offset + BATCH_SIZE < order.length ? offset + BATCH_SIZE : null,
    }
  }

  app.get('/', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const seed = randomSeed()
    const order = await select(seed, tags)
    const { names, nextOffset } = batchOf(order, 0)

    return renderPage(
      c,
      'uatu',
      <Gallery activeTags={tags}>
        <GalleryBody
          allTags={listTags(getDb())}
          activeTags={tags}
          matchCount={order.length}
          seed={seed}
        >
          <GridBatch names={names} seed={seed} nextOffset={nextOffset} tags={tags} />
        </GalleryBody>
      </Gallery>,
    )
  })

  app.get('/gallery/view', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const seed = seedFrom(c.req.query('seed'))
    const order = await select(seed, tags)
    const { names, nextOffset } = batchOf(order, 0)

    return c.html(
      <GalleryBody
        allTags={listTags(getDb())}
        activeTags={tags}
        matchCount={order.length}
        seed={seed}
      >
        <GridBatch names={names} seed={seed} nextOffset={nextOffset} tags={tags} />
      </GalleryBody>,
    )
  })

  app.get('/gallery', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const seed = seedFrom(c.req.query('seed'))
    const offset = offsetFrom(c.req.query('offset'))
    const order = await select(seed, tags)
    const { names, nextOffset } = batchOf(order, offset)

    return c.html(<GridBatch names={names} seed={seed} nextOffset={nextOffset} tags={tags} />)
  })

  return app
}

export const gallery = createGalleryRoutes(getDatabase)
```

- [ ] **Step 6: Carry the tags on the sentinel**

In `src/views/GridBatch.tsx`, accept the tags and put them on the sentinel URL — without this, batch 2 comes from the unfiltered catalog:

```tsx
import { buildGalleryQuery } from '../gallery/filter.js'
import { Tile } from './Tile.js'

export function GridBatch(props: {
  names: readonly string[]
  seed: number
  nextOffset: number | null
  tags: readonly string[]
}) {
  return (
    <>
      {props.names.map((name) => (
        <Tile key={name} name={name} />
      ))}
      {props.nextOffset !== null && (
        <div
          hx-get={`/gallery?${buildGalleryQuery({
            seed: props.seed,
            offset: props.nextOffset,
            tags: props.tags,
          })}`}
          hx-trigger="revealed"
          hx-swap="outerHTML"
          class="h-1 w-full"
        />
      )}
    </>
  )
}
```

- [ ] **Step 7: Fix the existing app test**

`src/app.test.ts` asserts `id="grid"` on `GET /`, which still holds. No change expected — but run it and confirm.

- [ ] **Step 8: Run everything**

Run: `npm run typecheck; echo "exit: $?"` then `npx vitest run`
Expected: exit 0, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Filter the gallery by tag with AND semantics"
```

---

### Task 5: Documentation and verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document it**

Add to the README after the Tagging section:

```markdown
### Filtering by tag

Chips above the grid narrow the gallery. Selecting several tags uses **AND** — each tag
added shows fewer images, not more. The selection appears in the page URL
(`/?tag=red-birds&tag=great-images`), so a filtered view is shareable and survives a
reload. The shuffle seed is deliberately *not* in the URL: reloading keeps your filter and
gives you a fresh order.

Two invariants keep this correct, both learned from the seeded shuffle:

- **Filtering happens before shuffling**, so the permutation is over the filtered list. The
  other order would make each batch an uneven slice of the unfiltered order.
- **The selected tags ride in every batch URL.** Without them on the infinite-scroll
  sentinel, batch two would come from the unfiltered catalog — correct on the first screen,
  wrong on the second.

Tag selections are deduplicated before querying. The AND query counts distinct matched
tags against the number requested, so a repeated `?tag=` would otherwise make a valid
filter return nothing.
```

- [ ] **Step 2: Full verification**

```bash
npm run typecheck; echo "typecheck exit: $?"
npx vitest run
rm -rf dist public/app.css && npm run build
rm -f /tmp/uatu-filter.db
DB_PATH=/tmp/uatu-filter.db PORT=3115 node dist/server.js &
sleep 1
# Tag two images, then confirm filtering narrows to them.
NAMES=$(curl -s http://127.0.0.1:3115/ | grep -o 'data-name="[^"]*"' | sed 's/data-name="//;s/"//' | head -2)
for n in $NAMES; do curl -s -X POST -d 'name=test-tag' "http://127.0.0.1:3115/images/$n/tags" > /dev/null; done
echo "unfiltered tiles: $(curl -s 'http://127.0.0.1:3115/gallery?seed=1&offset=0' | grep -c 'data-name=')"
echo "filtered tiles:   $(curl -s 'http://127.0.0.1:3115/gallery?tag=test-tag&seed=1&offset=0' | grep -c 'data-name=')"
echo "duplicate tag:    $(curl -s 'http://127.0.0.1:3115/gallery?tag=test-tag&tag=test-tag&seed=1&offset=0' | grep -c 'data-name=')"
echo "unknown tag:      $(curl -s 'http://127.0.0.1:3115/gallery?tag=nope&seed=1&offset=0' | grep -c 'data-name=')"
curl -s 'http://127.0.0.1:3115/?tag=test-tag' | grep -o 'id="result-count"' | head -1
kill %1
rm -f /tmp/uatu-filter.db
```

Expected: unfiltered 60, filtered 2, duplicate 2 (**not** 0), unknown 0, and the count element present.

- [ ] **Step 3: Commit and open a PR**

```bash
git add -A
git commit -m "Document tag filtering"
git push -u origin feat/tag-filter
gh pr create --base main --title "Filter gallery by tag"
```

---

## Risks

**The duplicate-tag trap.** `HAVING COUNT(DISTINCT tag.id) = ?` compared against the raw parameter count returns nothing when a tag repeats. Deduplication happens twice — in `parseTagSelection` and again in `imageNamesWithAllTags` — because either path can be reached directly. Both are covered by tests.

**Filter and batch drift.** If a future change adds a batch URL that omits the tags, filtering silently breaks on the second screen only. The "keeps the filter across batches" test is the guard.

**Untestable UI, as before.** Chip clicks, `hx-push-url`, and back-button behaviour need a browser. Tests cover the routes and markup.

**Orphaned associations.** Tags on images no longer on disk are filtered out naturally, since the result is intersected with the catalog listing.
