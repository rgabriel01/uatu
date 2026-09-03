import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCatalogCache } from '../gallery/catalog.js'
import { openDatabase } from '../db/index.js'
import { addTagToImage, createTag } from '../tags/store.js'

let dir: string

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js')
  return {
    ...actual,
    config: {
      ...actual.config,
      get imageDir() {
        return dir
      },
    },
  }
})

const { createGalleryRoutes, BATCH_SIZE } = await import('./gallery.js')

let tagDb: ReturnType<typeof openDatabase>
let gallery: ReturnType<typeof createGalleryRoutes>

/**
 * Counts tiles by their data-name hook rather than by <img> tags: the page also
 * contains the lightbox's own <img>, which is not a tile.
 */
function countTiles(html: string): number {
  return (html.match(/data-name="/g) ?? []).length
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

  tagDb = openDatabase(':memory:')
  gallery = createGalleryRoutes(() => tagDb)
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
    // Shuffle re-renders the whole body so the chips and count stay in step.
    expect(body).toContain('hx-get="/gallery/view"')
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

describe('lightbox markup contract', () => {
  it('renders the dialog and its image element', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="lightbox"')
    expect(body).toContain('id="lightbox-image"')
  })

  it('gives every tile a data-name for the lightbox to read', async () => {
    const body = await (await gallery.request('/')).text()
    const imgTags = (body.match(/<img /g) ?? []).length
    const named = (body.match(/data-name="/g) ?? []).length

    // The lightbox's own <img> has no data-name, hence the off-by-one.
    expect(named).toBe(imgTags - 1)
  })
})

describe('cog menu markup contract', () => {
  it('renders a cog button that opens the menu', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="settings-open"')
    expect(body).toContain('aria-label="Settings"')
  })

  it('renders a menu offering Interval and Tags', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="settings-menu"')
    expect(body).toContain('id="menu-interval"')
    expect(body).toContain('id="menu-tags"')
  })

  it('renders the interval dialog, defaulting to 6 seconds', async () => {
    const body = await (await gallery.request('/')).text()
    const input = body.match(/<input id="interval-input"[^>]*>/)![0]

    expect(input).toContain('value="6"')
    expect(input).toContain('min="1"')
    expect(input).toContain('max="60"')
  })

  it('renders an empty tags dialog for HTMX to fill', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="tags-dialog"')
    expect(body).toContain('id="tags-dialog-body"')
  })

  it('renders a tag panel host inside the lightbox', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="lightbox-tags"')
  })
})

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
    for (const name of [...first, ...second]) expect(many).toContain(name)
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
