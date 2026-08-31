import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { getDatabase } from '../db/index.js'
import { normalizeTagName } from '../tags/name.js'
import {
  DuplicateTagError,
  InvalidTagNameError,
  addTagToImage,
  createTag,
  deleteTag,
  listTags,
  removeTagFromImage,
  renameTag,
  tagUsageCount,
  tagsForImage,
} from '../tags/store.js'
import { ImageTags } from '../views/ImageTags.js'
import { TagManager, type TagRow } from '../views/TagManager.js'

function rows(db: DatabaseSync): TagRow[] {
  return listTags(db).map((tag) => ({ ...tag, usageCount: tagUsageCount(db, tag.id) }))
}

/** Turns the store's typed errors into a message, and anything else into a rethrow. */
function messageFor(error: unknown): string {
  if (error instanceof DuplicateTagError || error instanceof InvalidTagNameError) {
    return error.message
  }
  throw error
}

/**
 * The database is injected rather than imported so tests can supply an in-memory one
 * without mocking any module.
 */
export function createTagRoutes(getDb: () => DatabaseSync): Hono {
  const app = new Hono()

  app.get('/tags', (c) => c.html(<TagManager tags={rows(getDb())} />))

  app.post('/tags', async (c) => {
    const db = getDb()
    const name = String((await c.req.parseBody())['name'] ?? '')

    try {
      createTag(db, name)
    } catch (error) {
      return c.html(<TagManager tags={rows(db)} error={messageFor(error)} />)
    }
    return c.html(<TagManager tags={rows(db)} />)
  })

  app.post('/tags/:id/rename', async (c) => {
    const db = getDb()
    const id = Number(c.req.param('id'))
    const name = String((await c.req.parseBody())['name'] ?? '')

    try {
      renameTag(db, id, name)
    } catch (error) {
      return c.html(<TagManager tags={rows(db)} error={messageFor(error)} />)
    }
    return c.html(<TagManager tags={rows(db)} />)
  })

  app.post('/tags/:id/delete', (c) => {
    const db = getDb()
    deleteTag(db, Number(c.req.param('id')))
    return c.html(<TagManager tags={rows(db)} />)
  })

  app.get('/images/:name/tags', (c) => {
    const db = getDb()
    const imageName = c.req.param('name')
    return c.html(<ImageTags imageName={imageName} tags={tagsForImage(db, imageName)} />)
  })

  app.post('/images/:name/tags', async (c) => {
    const db = getDb()
    const imageName = c.req.param('name')
    const raw = String((await c.req.parseBody())['name'] ?? '')

    try {
      // Inline creation: an unknown name becomes a new tag rather than an error.
      const name = normalizeTagName(raw)
      const existing = listTags(db).find((tag) => tag.name === name)
      const tag = existing ?? createTag(db, raw)
      addTagToImage(db, imageName, tag.id)
    } catch (error) {
      return c.html(
        <ImageTags
          imageName={imageName}
          tags={tagsForImage(db, imageName)}
          error={messageFor(error)}
        />,
      )
    }

    return c.html(<ImageTags imageName={imageName} tags={tagsForImage(db, imageName)} />)
  })

  app.post('/images/:name/tags/:tagId/remove', (c) => {
    const db = getDb()
    const imageName = c.req.param('name')
    removeTagFromImage(db, imageName, Number(c.req.param('tagId')))
    return c.html(<ImageTags imageName={imageName} tags={tagsForImage(db, imageName)} />)
  })

  return app
}

export const tags = createTagRoutes(getDatabase)
