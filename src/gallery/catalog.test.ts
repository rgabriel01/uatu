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
