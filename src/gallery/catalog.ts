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
