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
