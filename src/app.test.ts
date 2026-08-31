import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCatalogCache } from './gallery/catalog.js'

let dir: string

// The real IMAGE_DIR does not exist on CI runners, so the app under test is pointed
// at a temp fixture directory instead.
vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js')
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

const { app } = await import('./app.js')

beforeEach(async () => {
  clearCatalogCache()
  dir = await mkdtemp(join(tmpdir(), 'uatu-app-'))
  await writeFile(join(dir, 'one.webp'), 'x')
  await writeFile(join(dir, 'two.webp'), 'x')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('GET /', () => {
  it('serves the gallery page', async () => {
    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const body = await res.text()
    expect(body).toContain('<!DOCTYPE html>')
    expect(body).toContain('id="grid"')
    expect(body).toContain('data-name="one.webp"')
  })
})

describe('GET /health', () => {
  it('reports ok', async () => {
    const res = await app.request('/health')

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok' })
  })
})

describe('unknown routes', () => {
  it('returns a 404 page', async () => {
    const res = await app.request('/no-such-page')

    expect(res.status).toBe(404)
    expect(await res.text()).toContain('Not found')
  })

  it('returns a 404 fragment for HTMX', async () => {
    const res = await app.request('/no-such-page', { headers: { 'HX-Request': 'true' } })

    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('<html')
  })
})
