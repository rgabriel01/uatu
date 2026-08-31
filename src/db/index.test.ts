import { describe, expect, it } from 'vitest'
import { openDatabase } from './index.js'

describe('openDatabase', () => {
  it('creates the tag and image_tag tables', () => {
    const db = openDatabase(':memory:')

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)

    expect(tables).toContain('tag')
    expect(tables).toContain('image_tag')
  })

  it('enforces foreign keys, so cascade actually cascades', () => {
    const db = openDatabase(':memory:')
    db.prepare('INSERT INTO tag (name) VALUES (?)').run('red-birds')
    db.prepare('INSERT INTO image_tag (image_name, tag_id) VALUES (?, ?)').run('a.webp', 1)

    db.prepare('DELETE FROM tag WHERE id = ?').run(1)

    const remaining = db.prepare('SELECT COUNT(*) AS c FROM image_tag').get() as { c: number }
    expect(remaining.c).toBe(0)
  })

  it('rejects an association pointing at a tag that does not exist', () => {
    const db = openDatabase(':memory:')

    expect(() =>
      db.prepare('INSERT INTO image_tag (image_name, tag_id) VALUES (?, ?)').run('a.webp', 999),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('rejects duplicate tag names', () => {
    const db = openDatabase(':memory:')
    db.prepare('INSERT INTO tag (name) VALUES (?)').run('red-birds')

    expect(() => db.prepare('INSERT INTO tag (name) VALUES (?)').run('red-birds')).toThrow(
      /UNIQUE/i,
    )
  })

  it('is safe to run twice against the same database', () => {
    const db = openDatabase(':memory:')
    expect(() => openDatabase(':memory:')).not.toThrow()
    expect((db.prepare('SELECT COUNT(*) AS c FROM tag').get() as { c: number }).c).toBe(0)
  })
})
