import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from '../config.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tag (
    id   INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS image_tag (
    image_name TEXT    NOT NULL,
    tag_id     INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (image_name, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_image_tag_tag ON image_tag(tag_id);
`

/**
 * Opens a database and brings it up to schema. Safe to call repeatedly.
 *
 * The foreign_keys pragma is per-connection and off by default in SQLite -- without
 * it, ON DELETE CASCADE silently does nothing and deleting a tag would leave orphaned
 * associations behind.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}

let instance: DatabaseSync | null = null

export function getDatabase(): DatabaseSync {
  instance ??= openDatabase(config.dbPath)
  return instance
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}
