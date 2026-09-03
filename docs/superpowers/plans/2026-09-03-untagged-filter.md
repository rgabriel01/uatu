# Untagged Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see only the images that carry no tags at all.

**Architecture:** One query returns the set of image names that have at least one tag; the untagged view is the on-disk catalog minus that set. It travels as its own `untagged=1` query parameter, threaded through every batch URL exactly as the tag selection is, and appears as a chip in the existing filter bar.

**Tech Stack:** Hono, Hono JSX, HTMX, Tailwind v4, `node:sqlite`, Vitest, Node ≥24. **No new dependencies.**

## Design decisions

**Untagged is mutually exclusive with tag filters.** An image carrying `red-birds` is by
definition not untagged, so the combination can only ever return nothing. Rather than
render an always-empty grid, selecting Untagged clears the tag chips and selecting a tag
clears Untagged. This is a UI rule; the route still handles the combination safely by
treating `untagged` as the winner (see Task 3).

**Its own query parameter, not a reserved tag name.** `?untagged=1` rather than
`?tag=untagged`. A user is free to create a tag literally called `untagged`, and
overloading the `tag` parameter would make that tag unusable.

**Subtract from the catalog rather than `NOT IN` in SQL.** `image_tag` can hold rows for
images no longer on disk. Starting from the catalog listing and removing the tagged names
means orphaned rows cannot leak into results, and it keeps the query a single
`SELECT DISTINCT`.

Verified before writing this plan: orphaned rows do not appear in results; removing one of
an image's two tags leaves it tagged; deleting every tag makes the whole catalog untagged
(cascade removes the association rows).

## The invariants this feature must not break

Both were learned the hard way on the seeded shuffle and the tag filter, and they apply
unchanged here:

- **Filter before shuffle**, so the permutation is over the filtered list.
- **The untagged flag rides in every batch URL.** Without it on the infinite-scroll
  sentinel, batch two comes from the unfiltered catalog — correct on the first screen,
  wrong on the second.

## Global Constraints

- Node `>=24`. **No new dependencies.**
- TypeScript `strict` plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- Relative imports carry explicit `.js` extensions; JSX files are `.tsx`.
- Tailwind only sees **literal** class strings.
- Tests colocate as `*.test.ts` and use an in-memory database plus a temp image directory.
- **Verify with explicit exit codes.** `npm run typecheck && echo PASS` hides failures under
  `set -e`, which ignores a failing left-hand side of `&&`. Use `npm run typecheck; echo "exit: $?"`.
- **This shell is zsh, which does not word-split unquoted variables.** `for n in $NAMES`
  runs once with the whole string. Use `while read -r n; do … done < file` in verification
  scripts.
- Run `npm run typecheck` and `npx vitest run` before every commit.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/tags/store.ts` (modify) | Adds `taggedImageNames` |
| `src/gallery/filter.ts` (modify) | Parses and serializes the `untagged` flag |
| `src/views/TagFilterBar.tsx` (modify) | Adds the Untagged chip and the exclusion rule |
| `src/views/GridBatch.tsx` (modify) | Carries the flag on the sentinel |
| `src/views/Gallery.tsx` (modify) | Shuffle preserves the flag |
| `src/routes/gallery.tsx` (modify) | Applies the flag when selecting |

---

### Task 1: The tagged-names query

**Files:**
- Modify: `src/tags/store.ts`, `src/tags/store.test.ts`

**Interfaces:**
- Produces: `taggedImageNames(db: DatabaseSync): Set<string>` — every image name with at
  least one tag.

- [ ] **Step 1: Write the failing test**

Append to `src/tags/store.test.ts`, adding `taggedImageNames` to the import list:

```ts
describe('taggedImageNames', () => {
  it('returns an empty set when nothing is tagged', () => {
    expect(taggedImageNames(db).size).toBe(0)
  })

  it('returns each image carrying at least one tag, once', () => {
    const red = createTag(db, 'red-birds')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', blue.id)
    addTagToImage(db, 'b.webp', red.id)

    expect([...taggedImageNames(db)].sort()).toEqual(['a.webp', 'b.webp'])
  })

  it('keeps an image tagged when only one of its tags is removed', () => {
    const red = createTag(db, 'red-birds')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', blue.id)

    removeTagFromImage(db, 'a.webp', red.id)

    expect(taggedImageNames(db).has('a.webp')).toBe(true)
  })

  it('drops an image once its last tag is removed', () => {
    const red = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', red.id)

    removeTagFromImage(db, 'a.webp', red.id)

    expect(taggedImageNames(db).has('a.webp')).toBe(false)
  })

  it('drops associations when the tag itself is deleted', () => {
    const red = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', red.id)

    deleteTag(db, red.id)

    expect(taggedImageNames(db).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/tags/store.test.ts -t 'taggedImageNames'`
Expected: FAIL — `taggedImageNames is not a function`.

- [ ] **Step 3: Implement**

Add to `src/tags/store.ts`:

```ts
/**
 * Every image name carrying at least one tag.
 *
 * Callers derive "untagged" by subtracting this from the on-disk catalog rather than
 * querying for absence: image_tag can hold rows for files that no longer exist, and
 * starting from the catalog keeps those orphans out of the result.
 */
export function taggedImageNames(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT DISTINCT image_name AS name FROM image_tag')
    .all() as unknown as { name: string }[]

  return new Set(rows.map((row) => row.name))
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tags/store.test.ts`
Expected: PASS, 31 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck; echo "exit: $?"
npx vitest run
git add src/tags/store.ts src/tags/store.test.ts
git commit -m "Add query for images carrying any tag"
```

---

### Task 2: Carry the flag in URLs

**Files:**
- Modify: `src/gallery/filter.ts`, `src/gallery/filter.test.ts`

**Interfaces:**
- `buildGalleryQuery` and `galleryUrl` gain an optional `untagged?: boolean`.
- Produces: `parseUntagged(raw: string | undefined): boolean`.

`untagged` is emitted only when true, so unfiltered URLs stay clean.

- [ ] **Step 1: Write the failing test**

Append to `src/gallery/filter.test.ts`, adding `parseUntagged` to the import list:

```ts
describe('parseUntagged', () => {
  it('is true for 1 and true', () => {
    expect(parseUntagged('1')).toBe(true)
    expect(parseUntagged('true')).toBe(true)
  })

  it('is false when absent', () => {
    expect(parseUntagged(undefined)).toBe(false)
  })

  it('is false for anything else', () => {
    expect(parseUntagged('0')).toBe(false)
    expect(parseUntagged('')).toBe(false)
    expect(parseUntagged('no')).toBe(false)
  })
})

describe('buildGalleryQuery with untagged', () => {
  it('emits untagged=1 when set', () => {
    expect(buildGalleryQuery({ seed: 7, tags: [], untagged: true })).toBe('seed=7&untagged=1')
  })

  it('omits it entirely when false, keeping URLs clean', () => {
    expect(buildGalleryQuery({ seed: 7, tags: [], untagged: false })).toBe('seed=7')
    expect(buildGalleryQuery({ seed: 7, tags: [] })).toBe('seed=7')
  })

  it('places untagged before tags for a stable order', () => {
    expect(buildGalleryQuery({ offset: 60, tags: ['apple'], untagged: true })).toBe(
      'offset=60&untagged=1&tag=apple',
    )
  })

  it('galleryUrl still omits the question mark when nothing is encoded', () => {
    expect(galleryUrl('/', { tags: [], untagged: false })).toBe('/')
    expect(galleryUrl('/', { tags: [], untagged: true })).toBe('/?untagged=1')
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/gallery/filter.test.ts`
Expected: FAIL — `parseUntagged` is not exported.

- [ ] **Step 3: Implement**

In `src/gallery/filter.ts`, add the parser:

```ts
/** Accepts the values a link or form would realistically produce; anything else is false. */
export function parseUntagged(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true'
}
```

and extend the builder's parameter type and body:

```ts
export function buildGalleryQuery(params: {
  seed?: number
  offset?: number
  tags: readonly string[]
  untagged?: boolean
}): string {
  const parts: string[] = []
  if (params.seed !== undefined) parts.push(`seed=${params.seed}`)
  if (params.offset !== undefined) parts.push(`offset=${params.offset}`)
  // Emitted only when true, so an unfiltered URL carries no trace of it.
  if (params.untagged === true) parts.push('untagged=1')
  for (const tag of params.tags) parts.push(`tag=${encodeURIComponent(tag)}`)
  return parts.join('&')
}
```

Widen `galleryUrl`'s parameter type to match:

```ts
export function galleryUrl(
  path: string,
  params: { seed?: number; offset?: number; tags: readonly string[]; untagged?: boolean },
): string {
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/gallery/filter.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck; echo "exit: $?"
git add src/gallery/filter.ts src/gallery/filter.test.ts
git commit -m "Carry the untagged flag in gallery URLs"
```

---

### Task 3: Apply the filter and add the chip

**Files:**
- Modify: `src/routes/gallery.tsx`, `src/views/TagFilterBar.tsx`, `src/views/GridBatch.tsx`, `src/views/Gallery.tsx`, `src/views/GalleryBody.tsx`
- Modify: `src/routes/gallery.test.ts`

**Route precedence.** If a request somehow arrives with both `untagged=1` and tags — a
hand-edited URL, or a stale link — `untagged` wins and the tags are ignored. Returning an
empty grid would be defensible but unhelpful, and the UI prevents the combination anyway.

- [ ] **Step 1: Write the failing tests**

Append to `src/routes/gallery.test.ts`:

```ts
describe('filtering to untagged images', () => {
  function tagImages(tagName: string, images: readonly string[]): void {
    const tag = createTag(tagDb, tagName)
    for (const image of images) addTagToImage(tagDb, image, tag.id)
  }

  it('shows every image when nothing is tagged', async () => {
    const body = await (await gallery.request('/gallery?untagged=1&seed=1&offset=0')).text()

    expect(countTiles(body)).toBe(BATCH_SIZE)
  })

  it('excludes images that carry a tag', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp'])

    const names = namesIn(
      await (await gallery.request('/gallery?untagged=1&seed=1&offset=0')).text(),
    )

    expect(names).not.toContain('img-000.webp')
    expect(names).not.toContain('img-001.webp')
  })

  it('excludes an image carrying any tag, not only all of them', async () => {
    tagImages('red-birds', ['img-000.webp'])
    tagImages('blue-sky', ['img-000.webp', 'img-001.webp'])

    const names = namesIn(
      await (await gallery.request('/gallery?untagged=1&seed=1&offset=0')).text(),
    )

    expect(names).not.toContain('img-000.webp')
    expect(names).not.toContain('img-001.webp')
  })

  it('reports the untagged count', async () => {
    tagImages('red-birds', ['img-000.webp', 'img-001.webp'])

    const body = await (await gallery.request('/gallery/view?untagged=1&seed=1')).text()

    // 150 fixtures, 2 tagged.
    expect(body).toMatch(/148 images/)
  })

  it('keeps the flag across batches -- same failure mode as the tag filter', async () => {
    tagImages('red-birds', ['img-000.webp'])

    const first = namesIn(
      await (await gallery.request('/gallery?untagged=1&seed=5&offset=0')).text(),
    )
    const second = namesIn(
      await (await gallery.request('/gallery?untagged=1&seed=5&offset=60')).text(),
    )

    expect(first).toHaveLength(BATCH_SIZE)
    expect(second).toHaveLength(BATCH_SIZE)
    expect([...first, ...second]).not.toContain('img-000.webp')
    expect(new Set([...first, ...second]).size).toBe(120)
  })

  it('carries the flag on the sentinel URL', async () => {
    const body = await (await gallery.request('/gallery?untagged=1&seed=5&offset=0')).text()

    expect(body).toContain('untagged=1')
    expect(body).toContain('offset=60')
  })

  it('is stable for the same seed', async () => {
    const a = await (await gallery.request('/gallery?untagged=1&seed=3&offset=0')).text()
    const b = await (await gallery.request('/gallery?untagged=1&seed=3&offset=0')).text()

    expect(namesIn(a)).toEqual(namesIn(b))
  })

  it('returns nothing when every image is tagged', async () => {
    const all = Array.from({ length: 150 }, (_, i) => `img-${String(i).padStart(3, '0')}.webp`)
    tagImages('everything', all)

    const body = await (await gallery.request('/gallery?untagged=1&seed=1&offset=0')).text()

    expect(countTiles(body)).toBe(0)
  })

  it('lets untagged win if tags are also present', async () => {
    tagImages('red-birds', ['img-000.webp'])

    const names = namesIn(
      await (await gallery.request('/gallery?untagged=1&tag=red-birds&seed=1&offset=0')).text(),
    )

    expect(names).not.toContain('img-000.webp')
    expect(names.length).toBe(BATCH_SIZE)
  })

  it('applies the flag from the page URL', async () => {
    tagImages('red-birds', ['img-000.webp'])

    const body = await (await gallery.request('/?untagged=1')).text()

    expect(body).toContain('<!DOCTYPE html>')
    expect(namesIn(body)).not.toContain('img-000.webp')
  })
})

describe('untagged chip', () => {
  it('renders an Untagged chip', async () => {
    const body = await (await gallery.request('/gallery/view?seed=1')).text()

    expect(body).toContain('id="untagged-chip"')
    expect(body).toContain('Untagged')
  })

  it('marks the chip pressed when the filter is on', async () => {
    const body = await (await gallery.request('/gallery/view?untagged=1&seed=1')).text()

    expect(body).toMatch(/id="untagged-chip"[^>]*aria-pressed="true"/)
  })

  it('selecting a tag clears untagged -- the two are mutually exclusive', async () => {
    createTag(tagDb, 'red-birds')

    const body = await (await gallery.request('/gallery/view?untagged=1&seed=1')).text()

    // The red-birds chip links to a selection with the tag and no untagged flag.
    expect(body).toMatch(/hx-get="[^"]*tag=red-birds"/)
    expect(body).not.toMatch(/hx-get="[^"]*untagged=1&amp;tag=red-birds"/)
  })

  it('the untagged chip clears any selected tags', async () => {
    createTag(tagDb, 'red-birds')

    const body = await (await gallery.request('/gallery/view?tag=red-birds&seed=1')).text()
    const chip = body.match(/<button id="untagged-chip"[^>]*>/)![0]

    expect(chip).not.toContain('tag=red-birds')
    expect(chip).toContain('untagged=1')
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/routes/gallery.test.ts`
Expected: FAIL — the flag is ignored and there is no chip.

- [ ] **Step 3: Thread the flag through the views**

`src/views/GridBatch.tsx` — add `untagged: boolean` to props and pass it to `galleryUrl`:

```tsx
export function GridBatch(props: {
  names: readonly string[]
  seed: number
  nextOffset: number | null
  tags: readonly string[]
  untagged: boolean
}) {
```

```tsx
          hx-get={galleryUrl('/gallery', {
            seed: props.seed,
            offset: props.nextOffset,
            tags: props.tags,
            untagged: props.untagged,
          })}
```

`src/views/Gallery.tsx` — add `untagged: boolean` to props so Shuffle preserves it:

```tsx
export function Gallery(props: {
  activeTags: readonly string[]
  untagged: boolean
  children?: Child
}) {
```

```tsx
            hx-get={galleryUrl('/gallery/view', {
              tags: props.activeTags,
              untagged: props.untagged,
            })}
```

`src/views/GalleryBody.tsx` — add `untagged: boolean` and pass it to the filter bar:

```tsx
export function GalleryBody(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  untagged: boolean
  matchCount: number
  seed: number
  children?: Child
}) {
```

```tsx
      <TagFilterBar
        allTags={props.allTags}
        activeTags={props.activeTags}
        untagged={props.untagged}
        matchCount={props.matchCount}
        seed={props.seed}
      />
```

- [ ] **Step 4: Add the chip and the exclusion rule**

Replace `src/views/TagFilterBar.tsx` with:

```tsx
import { galleryUrl } from '../gallery/filter.js'
import type { Tag } from '../tags/store.js'

function toggled(active: readonly string[], name: string): string[] {
  return active.includes(name) ? active.filter((t) => t !== name) : [...active, name].sort()
}

const ACTIVE_CHIP =
  'rounded-full border border-accent bg-accent px-3 py-1 text-sm text-white dark:border-accent-dark dark:bg-accent-dark dark:text-neutral-900'
const IDLE_CHIP =
  'rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
const IDLE_UNTAGGED_CHIP =
  'rounded-full border border-dashed border-neutral-400 px-3 py-1 text-sm text-neutral-600 hover:border-neutral-500 dark:border-neutral-500 dark:text-neutral-400'

/**
 * Chip bar plus the result count. Lives inside #gallery-body with the grid, so one
 * swap keeps the chips, the count, and the images consistent with each other.
 *
 * Untagged and tag chips are mutually exclusive: an image carrying a tag is never
 * untagged, so allowing both would only ever produce an empty grid. Each chip's link
 * therefore clears the other mode rather than adding to it.
 */
export function TagFilterBar(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  untagged: boolean
  matchCount: number
  seed: number
}) {
  const active = props.activeTags
  const anyFilter = props.untagged || active.length > 0

  return (
    <div class="mb-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          id="untagged-chip"
          type="button"
          hx-get={galleryUrl('/gallery/view', {
            seed: props.seed,
            tags: [],
            untagged: !props.untagged,
          })}
          hx-target="#gallery-body"
          hx-swap="outerHTML"
          hx-push-url={galleryUrl('/', { tags: [], untagged: !props.untagged })}
          aria-pressed={props.untagged ? 'true' : 'false'}
          class={props.untagged ? ACTIVE_CHIP : IDLE_UNTAGGED_CHIP}
        >
          Untagged
        </button>

        {props.allTags.map((tag) => {
          const next = toggled(active, tag.name)
          const isActive = active.includes(tag.name)
          return (
            <button
              key={tag.id}
              type="button"
              hx-get={galleryUrl('/gallery/view', {
                seed: props.seed,
                tags: next,
                untagged: false,
              })}
              hx-target="#gallery-body"
              hx-swap="outerHTML"
              hx-push-url={galleryUrl('/', { tags: next, untagged: false })}
              aria-pressed={isActive ? 'true' : 'false'}
              class={isActive ? ACTIVE_CHIP : IDLE_CHIP}
            >
              {tag.name}
            </button>
          )
        })}

        {anyFilter && (
          <button
            type="button"
            id="clear-filter"
            hx-get={galleryUrl('/gallery/view', { seed: props.seed, tags: [], untagged: false })}
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
        {props.untagged && ' with no tags'}
        {!props.untagged &&
          active.length > 0 &&
          ` matching ${active.length} ${active.length === 1 ? 'tag' : 'tags'}`}
      </p>
    </div>
  )
}
```

- [ ] **Step 5: Apply the flag in the routes**

In `src/routes/gallery.tsx`, import the parser and the query:

```tsx
import { galleryUrl, parseTagSelection, parseUntagged } from '../gallery/filter.js'
import { imageNamesWithAllTags, listTags, taggedImageNames } from '../tags/store.js'
```

(`galleryUrl` is only needed if the routes build URLs; if not already imported, leave it out.)

Replace `select` with a version that takes both:

```tsx
  /**
   * Filtering happens BEFORE shuffling so the permutation is over the filtered list.
   *
   * `untagged` takes precedence over tags: the two are mutually exclusive, and a
   * request carrying both is a hand-edited or stale URL rather than a real intent.
   */
  async function select(
    seed: number,
    tags: readonly string[],
    untagged: boolean,
  ): Promise<string[]> {
    const catalog = await readCatalog(config.imageDir)

    let names: readonly string[] = catalog.names
    if (untagged) {
      const tagged = taggedImageNames(getDb())
      names = names.filter((name) => !tagged.has(name))
    } else if (tags.length > 0) {
      const allowed = imageNamesWithAllTags(getDb(), tags)
      names = names.filter((name) => allowed.has(name))
    }

    return shuffled(names, seed)
  }
```

In each of the three handlers, read the flag and pass it down. For `GET /`:

```tsx
  app.get('/', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const untagged = parseUntagged(c.req.query('untagged'))
    const seed = randomSeed()
    const order = await select(seed, tags, untagged)
    const { names, nextOffset } = batchOf(order, 0)

    return renderPage(
      c,
      'uatu',
      <Gallery activeTags={tags} untagged={untagged}>
        <GalleryBody
          allTags={listTags(getDb())}
          activeTags={tags}
          untagged={untagged}
          matchCount={order.length}
          seed={seed}
        >
          <GridBatch
            names={names}
            seed={seed}
            nextOffset={nextOffset}
            tags={tags}
            untagged={untagged}
          />
        </GalleryBody>
      </Gallery>,
    )
  })
```

For `GET /gallery/view`, the same but with `seedFrom(c.req.query('seed'))` and returning
the `GalleryBody` fragment directly. For `GET /gallery`, the same but returning only the
`GridBatch`, using `offsetFrom(c.req.query('offset'))`.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck; echo "exit: $?"` then `npx vitest run`
Expected: exit 0, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add untagged filter with an Untagged chip"
```

---

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document it**

In the README's "Filtering by tag" section, after the first paragraph, add:

```markdown
An **Untagged** chip shows only images carrying no tags at all (`/?untagged=1`). It is
mutually exclusive with the tag chips — an image with a tag is never untagged, so
selecting one mode clears the other. The set is computed as the on-disk catalog minus
every image with at least one tag, which keeps rows for deleted files from leaking into
results.
```

- [ ] **Step 2: Full verification**

Note the zsh word-splitting rule from Global Constraints — this script uses `while read`.

```bash
npm run typecheck; echo "typecheck exit: $?"
npx vitest run
rm -rf dist public/app.css && npm run build
rm -f /tmp/uatu-untagged.db
DB_PATH=/tmp/uatu-untagged.db PORT=3120 node dist/server.js &
sleep 1
count() { grep -o 'data-name=' | wc -l | tr -d ' '; }
curl -s http://127.0.0.1:3120/ | grep -o 'data-name="[^"]*"' | sed 's/data-name="//;s/"//' | head -2 > /tmp/uatu-n.txt
while read -r n; do
  curl -s -o /dev/null -X POST -d 'name=test-tag' "http://127.0.0.1:3120/images/$n/tags"
done < /tmp/uatu-n.txt
TAGGED=$(head -1 /tmp/uatu-n.txt)
echo "unfiltered   (expect 60): $(curl -s 'http://127.0.0.1:3120/gallery?seed=1&offset=0' | count)"
echo "untagged     (expect 60): $(curl -s 'http://127.0.0.1:3120/gallery?untagged=1&seed=1&offset=0' | count)"
echo "tagged image excluded (expect 0): $(curl -s 'http://127.0.0.1:3120/?untagged=1' | grep -c "data-name=\"$TAGGED\"")"
echo "count line: $(curl -s 'http://127.0.0.1:3120/?untagged=1' | grep -o 'result-count[^>]*>[^<]*' | sed 's/.*>//')"
echo "chip pressed: $(curl -s 'http://127.0.0.1:3120/?untagged=1' | grep -o 'id="untagged-chip"[^>]*aria-pressed="true"' | wc -l | tr -d ' ')"
kill %1
rm -f /tmp/uatu-untagged.db /tmp/uatu-n.txt
```

Expected: unfiltered 60, untagged 60 (1247 remain untagged, so a full batch), the tagged
image absent from the untagged page, the count reading "1247 images with no tags", and the
chip marked pressed.

- [ ] **Step 3: Commit and open a PR**

```bash
git add -A
git commit -m "Document the untagged filter"
git push -u origin feat/untagged-filter
gh pr create --base main --title "Filter images with no tags"
```

---

## Risks

**Precedence drift.** If a future change makes tags win over `untagged`, the combination
silently returns nothing. The "lets untagged win if tags are also present" test pins it.

**Flag and batch drift.** A new batch URL that omits `untagged` would break filtering on
the second screen only. The "keeps the flag across batches" test is the guard.

**Untestable UI.** Chip clicks, `hx-push-url`, and back-button behaviour need a browser.
Routes and markup are covered by tests.
