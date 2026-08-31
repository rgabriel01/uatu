import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/index.js'
import { addTagToImage, createTag, listTags, tagsForImage } from '../tags/store.js'
import { createTagRoutes } from './tags.js'

let db: DatabaseSync
let app: ReturnType<typeof createTagRoutes>

beforeEach(() => {
  db = openDatabase(':memory:')
  app = createTagRoutes(() => db)
})

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }
}

describe('GET /tags', () => {
  it('lists existing tags', async () => {
    createTag(db, 'red-birds')
    createTag(db, 'great-images')
    const body = await (await app.request('/tags')).text()
    expect(body).toContain('red-birds')
    expect(body).toContain('great-images')
  })

  it('returns a bare fragment, not a document', async () => {
    const body = await (await app.request('/tags')).text()
    expect(body).not.toContain('<html')
    expect(body).not.toContain('<!DOCTYPE')
  })

  it('shows how many images use each tag', async () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    addTagToImage(db, 'b.webp', tag.id)
    const body = await (await app.request('/tags')).text()
    expect(body).toMatch(/2\s*(images|uses)/i)
  })
})

describe('POST /tags', () => {
  it('creates a tag', async () => {
    const res = await app.request('/tags', form({ name: 'red-birds' }))
    expect(res.status).toBe(200)
    expect(listTags(db).map((t) => t.name)).toEqual(['red-birds'])
    expect(await res.text()).toContain('red-birds')
  })

  it('reports a duplicate without creating a second one', async () => {
    createTag(db, 'red-birds')
    const body = await (await app.request('/tags', form({ name: 'red-birds' }))).text()
    expect(body).toMatch(/already exists/i)
    expect(listTags(db)).toHaveLength(1)
  })

  it('reports an invalid name', async () => {
    const body = await (await app.request('/tags', form({ name: 'red birds' }))).text()
    expect(body).toMatch(/hyphen/i)
    expect(listTags(db)).toHaveLength(0)
  })
})

describe('POST /tags/:id/rename', () => {
  it('renames a tag', async () => {
    const tag = createTag(db, 'red-birds')
    await app.request(`/tags/${tag.id}/rename`, form({ name: 'blue-birds' }))
    expect(listTags(db).map((t) => t.name)).toEqual(['blue-birds'])
  })

  it('reports a collision without renaming', async () => {
    const tag = createTag(db, 'red-birds')
    createTag(db, 'blue-birds')
    const body = await (
      await app.request(`/tags/${tag.id}/rename`, form({ name: 'blue-birds' }))
    ).text()
    expect(body).toMatch(/already exists/i)
    expect(listTags(db).map((t) => t.name)).toEqual(['blue-birds', 'red-birds'])
  })
})

describe('POST /tags/:id/delete', () => {
  it('deletes the tag and its associations', async () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    await app.request(`/tags/${tag.id}/delete`, form({}))
    expect(listTags(db)).toEqual([])
    expect(tagsForImage(db, 'a.webp')).toEqual([])
  })

  it('is a no-op for an unknown id', async () => {
    createTag(db, 'red-birds')
    const res = await app.request('/tags/999/delete', form({}))
    expect(res.status).toBe(200)
    expect(listTags(db)).toHaveLength(1)
  })
})

describe('GET /images/:name/tags', () => {
  it('lists the tags on an image', async () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    const body = await (await app.request('/images/a.webp/tags')).text()
    expect(body).toContain('red-birds')
  })

  it('returns a bare fragment', async () => {
    const body = await (await app.request('/images/a.webp/tags')).text()
    expect(body).not.toContain('<html')
  })

  it('handles an image with no tags', async () => {
    const res = await app.request('/images/untagged.webp/tags')
    expect(res.status).toBe(200)
  })
})

describe('POST /images/:name/tags', () => {
  it('applies an existing tag', async () => {
    createTag(db, 'red-birds')
    await app.request('/images/a.webp/tags', form({ name: 'red-birds' }))
    expect(tagsForImage(db, 'a.webp').map((t) => t.name)).toEqual(['red-birds'])
  })

  it('creates the tag inline when it does not exist yet', async () => {
    await app.request('/images/a.webp/tags', form({ name: 'brand-new' }))
    expect(listTags(db).map((t) => t.name)).toEqual(['brand-new'])
    expect(tagsForImage(db, 'a.webp').map((t) => t.name)).toEqual(['brand-new'])
  })

  it('does not duplicate a tag already on the image', async () => {
    await app.request('/images/a.webp/tags', form({ name: 'red-birds' }))
    await app.request('/images/a.webp/tags', form({ name: 'red-birds' }))
    expect(tagsForImage(db, 'a.webp')).toHaveLength(1)
    expect(listTags(db)).toHaveLength(1)
  })

  it('reports an invalid name without creating anything', async () => {
    const body = await (await app.request('/images/a.webp/tags', form({ name: 'bad name' }))).text()
    expect(body).toMatch(/hyphen/i)
    expect(listTags(db)).toHaveLength(0)
  })

  it('applies several tags to one image', async () => {
    await app.request('/images/a.webp/tags', form({ name: 'apple' }))
    await app.request('/images/a.webp/tags', form({ name: 'zebra' }))
    expect(tagsForImage(db, 'a.webp').map((t) => t.name)).toEqual(['apple', 'zebra'])
  })
})

describe('POST /images/:name/tags/:tagId/remove', () => {
  it('removes the tag from the image but keeps the tag itself', async () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    await app.request(`/images/a.webp/tags/${tag.id}/remove`, form({}))
    expect(tagsForImage(db, 'a.webp')).toEqual([])
    expect(listTags(db).map((t) => t.name)).toEqual(['red-birds'])
  })

  it('leaves other images alone', async () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    addTagToImage(db, 'b.webp', tag.id)
    await app.request(`/images/a.webp/tags/${tag.id}/remove`, form({}))
    expect(tagsForImage(db, 'b.webp').map((t) => t.name)).toEqual(['red-birds'])
  })
})
