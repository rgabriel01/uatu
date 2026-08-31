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
