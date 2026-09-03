import type { DatabaseSync } from 'node:sqlite'
import { normalizeTagName, tagNameError } from './name.js'

export interface Tag {
  readonly id: number
  readonly name: string
}

export class DuplicateTagError extends Error {
  constructor(name: string) {
    super(`A tag named "${name}" already exists.`)
    this.name = 'DuplicateTagError'
  }
}

export class InvalidTagNameError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InvalidTagNameError'
  }
}

/** Normalizes and validates, throwing InvalidTagNameError with a displayable reason. */
function toValidName(raw: string): string {
  const name = normalizeTagName(raw)
  const error = tagNameError(name)
  if (error !== null) {
    throw new InvalidTagNameError(error)
  }
  return name
}

export function listTags(db: DatabaseSync): Tag[] {
  return db.prepare('SELECT id, name FROM tag ORDER BY name').all() as unknown as Tag[]
}

function findByName(db: DatabaseSync, name: string): Tag | undefined {
  return db.prepare('SELECT id, name FROM tag WHERE name = ?').get(name) as unknown as
    | Tag
    | undefined
}

export function createTag(db: DatabaseSync, rawName: string): Tag {
  const name = toValidName(rawName)

  // Checked up front so the caller gets a useful message rather than a constraint
  // error; the UNIQUE index remains the real guarantee.
  if (findByName(db, name) !== undefined) {
    throw new DuplicateTagError(name)
  }

  const { lastInsertRowid } = db.prepare('INSERT INTO tag (name) VALUES (?)').run(name)
  return { id: Number(lastInsertRowid), name }
}

export function renameTag(db: DatabaseSync, id: number, rawName: string): Tag {
  const name = toValidName(rawName)

  const existing = findByName(db, name)
  if (existing !== undefined && existing.id !== id) {
    throw new DuplicateTagError(name)
  }

  db.prepare('UPDATE tag SET name = ? WHERE id = ?').run(name, id)
  return { id, name }
}

export function deleteTag(db: DatabaseSync, id: number): void {
  // image_tag rows go with it via ON DELETE CASCADE.
  db.prepare('DELETE FROM tag WHERE id = ?').run(id)
}

export function tagUsageCount(db: DatabaseSync, id: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM image_tag WHERE tag_id = ?').get(id) as
    | { c: number }
    | undefined
  return row?.c ?? 0
}

export function tagsForImage(db: DatabaseSync, imageName: string): Tag[] {
  return db
    .prepare(
      `SELECT tag.id, tag.name
         FROM tag
         JOIN image_tag ON image_tag.tag_id = tag.id
        WHERE image_tag.image_name = ?
        ORDER BY tag.name`,
    )
    .all(imageName) as unknown as Tag[]
}

export function addTagToImage(db: DatabaseSync, imageName: string, tagId: number): void {
  db.prepare('INSERT OR IGNORE INTO image_tag (image_name, tag_id) VALUES (?, ?)').run(
    imageName,
    tagId,
  )
}

export function removeTagFromImage(db: DatabaseSync, imageName: string, tagId: number): void {
  db.prepare('DELETE FROM image_tag WHERE image_name = ? AND tag_id = ?').run(imageName, tagId)
}

/**
 * Image names carrying EVERY one of `tagNames` (AND, not OR).
 *
 * The names are deduplicated first: HAVING compares against the number of distinct
 * matched tags, so passing the same tag twice would make the required count exceed
 * what any image can satisfy and silently return nothing.
 *
 * An empty selection yields an empty set. Callers wanting "no filter" must skip this
 * call rather than pass an empty list.
 */
export function imageNamesWithAllTags(
  db: DatabaseSync,
  tagNames: readonly string[],
): Set<string> {
  const unique = [...new Set(tagNames)]
  if (unique.length === 0) {
    return new Set()
  }

  const placeholders = unique.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT image_tag.image_name AS name
         FROM image_tag
         JOIN tag ON tag.id = image_tag.tag_id
        WHERE tag.name IN (${placeholders})
        GROUP BY image_tag.image_name
       HAVING COUNT(DISTINCT tag.id) = ?`,
    )
    .all(...unique, unique.length) as unknown as { name: string }[]

  return new Set(rows.map((row) => row.name))
}

/**
 * Every image name carrying at least one tag.
 *
 * Callers derive "untagged" by subtracting this from the on-disk catalog rather than
 * querying for absence: image_tag can hold rows for files that no longer exist, and
 * starting from the catalog keeps those orphans out of the result.
 */
export function taggedImageNames(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT DISTINCT image_name AS name FROM image_tag')
    .all() as unknown as { name: string }[]

  return new Set(rows.map((row) => row.name))
}
