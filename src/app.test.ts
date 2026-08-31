import { describe, expect, it } from 'vitest'
import { app } from './app.js'

describe('GET /', () => {
  it('returns a full HTML document for an ordinary request', async () => {
    const res = await app.request('/')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const body = await res.text()
    expect(body).toContain('<!DOCTYPE html>')
    expect(body).toContain('<title>uatu</title>')
    expect(body).toContain('<main id="app">')
  })

  it('returns a bare fragment when HTMX asks for one', async () => {
    const res = await app.request('/', { headers: { 'HX-Request': 'true' } })

    expect(res.status).toBe(200)

    const body = await res.text()
    expect(body).toContain('<main id="app">')
    // The whole point of the fragment path: no document wrapper to nest.
    expect(body).not.toContain('<html')
    expect(body).not.toContain('<!DOCTYPE')
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
