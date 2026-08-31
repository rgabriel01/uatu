import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCatalogCache } from '../gallery/catalog.js'

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

const { gallery, BATCH_SIZE } = await import('./gallery.js')

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
