# Image Tagging Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create and manage kebab-case tags, and apply multiple tags to any image from the viewer, backed by SQLite.

**Architecture:** `node:sqlite` (built into Node, zero dependencies) stores tags and image-tag associations. A pure name module owns format rules; a store module owns queries and takes the database as its first argument so tests can pass an in-memory one with no mocking. Tag UI is server-rendered HTML fragments driven by HTMX, including inside the lightbox, so no markup is duplicated in JavaScript.

**Tech Stack:** Hono, Hono JSX, HTMX, Tailwind v4, `node:sqlite`, Vitest, Node ≥24. **No new dependencies.**

**Scope:** Phase 1 is storage, tag management, and per-image tagging. **Filtering the gallery by tag is Phase 2** and gets its own plan.

## Global Constraints

- Node `>=24` after Task 1. `node:sqlite` is flagged on Node 22, which is why the floor moves.
- **No new runtime or dev dependencies.**
- TypeScript `strict` plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- ESM with `module: nodenext`: every relative import carries an explicit `.js` extension.
- Files containing JSX must be `.tsx`.
- Tailwind only sees **literal** class strings.
- Tests colocate as `*.test.ts`; import from `vitest` explicitly.
- Tests use an in-memory database. No test touches the real database file or image directory.
- Run `npm run typecheck && npm test` before every commit.

## Data model

```sql
CREATE TABLE tag (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE image_tag (
  image_name TEXT    NOT NULL,
  tag_id     INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (image_name, tag_id)
);

CREATE INDEX idx_image_tag_tag ON image_tag(tag_id);
```

**Why `image_name TEXT` and not an `image` table.** Images live on disk and are identified by filename; the catalog is read from the directory, not the database. An `image` table would have to be kept in sync with the filesystem on every scan. Storing the filename directly removes that problem entirely. If a file is deleted from disk its rows simply stop matching anything — harmless, and cheap to clean up later if it ever matters.

**`PRAGMA foreign_keys = ON` is required.** SQLite does not enforce foreign keys by default, so without it `ON DELETE CASCADE` silently does nothing and deleting a tag would leave orphaned associations. It must be set on every connection, not once at creation.

Verified against `node:sqlite` before writing this plan: `run()` returns `{changes, lastInsertRowid}` as numbers, cascade deletes work with the pragma on, and a duplicate insert throws an `Error` with `code === 'ERR_SQLITE_ERROR'` and message `UNIQUE constraint failed: tag.name`.

---

### Task 1: Move the Node floor to 24 — DO THIS FIRST

`node:sqlite` is behind `--experimental-sqlite` on Node 22, so the floor moves to 24.

**This task has an ordering hazard.** `test (node 22)` is a *required status check* in `main`'s branch protection. If you remove Node 22 from the CI matrix first, the resulting PR waits forever on a check that no longer runs and cannot be merged. **Update branch protection before opening any PR that changes the matrix.**

**Files:**
- Modify: `package.json`, `.github/workflows/ci.yml`, `README.md`

- [ ] **Step 1: Update branch protection first**

```bash
gh api -X PUT repos/rgabriel01/uatu/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["test (node 24)", "docker build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

Verify: `gh api repos/rgabriel01/uatu/branches/main/protection --jq '.required_status_checks.contexts'`
Expected: `["test (node 24)","docker build"]`

- [ ] **Step 2: Raise the engines floor**

In `package.json`:

```json
  "engines": {
    "node": ">=24"
  },
```

- [ ] **Step 3: Drop Node 22 from the CI matrix**

In `.github/workflows/ci.yml`:

```yaml
        node: ['24']
```

- [ ] **Step 4: Update the README**

Change `Node 22 or newer.` to:

```markdown
Node 24 or newer — the app uses `node:sqlite`, which is flagged on Node 22.
```

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && npx vitest run
git add package.json .github/workflows/ci.yml README.md
git commit -m "Raise Node floor to 24 for node:sqlite"
```

---

### Task 2: Tag name rules

**Files:**
- Create: `src/tags/name.ts`
- Test: `src/tags/name.test.ts`

**Interfaces:**
- Produces: `TAG_NAME_PATTERN`, `MAX_TAG_NAME_LENGTH`, `normalizeTagName(raw: string): string`, `tagNameError(name: string): string | null` (null means valid).

- [ ] **Step 1: Write the failing test**

```ts
// src/tags/name.test.ts
import { describe, expect, it } from 'vitest'
import { MAX_TAG_NAME_LENGTH, normalizeTagName, tagNameError } from './name.js'

describe('normalizeTagName', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTagName('  red-birds  ')).toBe('red-birds')
  })

  it('lowercases', () => {
    expect(normalizeTagName('Red-Birds')).toBe('red-birds')
  })

  it('leaves an already-clean name alone', () => {
    expect(normalizeTagName('great-images')).toBe('great-images')
  })
})

describe('tagNameError', () => {
  it('accepts kebab-case names', () => {
    for (const name of ['red-birds', 'great-images', 'a', 'a-b-c', 'birds2', 'x9-y8']) {
      expect(tagNameError(name)).toBeNull()
    }
  })

  it('rejects an empty name', () => {
    expect(tagNameError('')).toMatch(/empty/i)
  })

  it('rejects spaces', () => {
    expect(tagNameError('red birds')).toMatch(/hyphen/i)
  })

  it('rejects underscores and other separators', () => {
    expect(tagNameError('red_birds')).toMatch(/hyphen/i)
    expect(tagNameError('red.birds')).toMatch(/hyphen/i)
  })

  it('rejects uppercase -- callers must normalize first', () => {
    expect(tagNameError('Red-Birds')).toMatch(/hyphen/i)
  })

  it('rejects leading, trailing, and doubled hyphens', () => {
    expect(tagNameError('-birds')).toMatch(/hyphen/i)
    expect(tagNameError('birds-')).toMatch(/hyphen/i)
    expect(tagNameError('red--birds')).toMatch(/hyphen/i)
  })

  it('rejects a name longer than the limit', () => {
    expect(tagNameError('a'.repeat(MAX_TAG_NAME_LENGTH + 1))).toMatch(/longer|characters/i)
    expect(tagNameError('a'.repeat(MAX_TAG_NAME_LENGTH))).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/tags/name.test.ts`
Expected: FAIL — cannot resolve `./name.js`.

- [ ] **Step 3: Implement**

```ts
// src/tags/name.ts

/** Lowercase alphanumeric words joined by single hyphens: `red-birds`, `great-images`. */
export const TAG_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const MAX_TAG_NAME_LENGTH = 50

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Returns a human-readable reason the name is invalid, or null if it is fine.
 * Callers normalize first; this deliberately rejects uppercase so a skipped
 * normalize cannot slip an inconsistent name into the database.
 */
export function tagNameError(name: string): string | null {
  if (name.length === 0) {
    return 'Tag name cannot be empty.'
  }
  if (name.length > MAX_TAG_NAME_LENGTH) {
    return `Tag name cannot be longer than ${MAX_TAG_NAME_LENGTH} characters.`
  }
  if (!TAG_NAME_PATTERN.test(name)) {
    return 'Use lowercase words separated by single hyphens, like red-birds.'
  }
  return null
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tags/name.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/tags/name.ts src/tags/name.test.ts
git commit -m "Add tag name format rules"
```

---

### Task 3: Database module

**Files:**
- Create: `src/db/index.ts`
- Test: `src/db/index.test.ts`
- Modify: `src/config.ts`, `src/config.test.ts`

**Interfaces:**
- Produces: `openDatabase(path: string): DatabaseSync` (opens, sets the pragma, applies the schema), `getDatabase(): DatabaseSync` (lazy singleton on `config.dbPath`), `closeDatabase(): void`. Config gains `dbPath: string`.

- [ ] **Step 1: Write the failing test**

```ts
// src/db/index.test.ts
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

    const remaining = db.prepare('SELECT COUNT(*) AS c FROM image_tag').get()
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
    expect(db.prepare('SELECT COUNT(*) AS c FROM tag').get().c).toBe(0)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/db/index.test.ts`
Expected: FAIL — cannot resolve `./index.js`.

- [ ] **Step 3: Implement the database module**

```ts
// src/db/index.ts
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
```

- [ ] **Step 4: Add `dbPath` to config**

Append to `src/config.test.ts`:

```ts
describe('dbPath', () => {
  it('defaults to a data directory beside the working directory', () => {
    expect(loadConfig({ HOME: '/home/someone' }).dbPath).toBe('./data/uatu.db')
  })

  it('honours DB_PATH', () => {
    expect(loadConfig({ HOME: '/home/someone', DB_PATH: '/srv/uatu.db' }).dbPath).toBe(
      '/srv/uatu.db',
    )
  })
})
```

Update the existing "applies defaults for an empty environment" test to include the new field:

```ts
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({ HOME: '/home/someone' })).toEqual({
      port: 3000,
      host: '0.0.0.0',
      nodeEnv: 'development',
      isProduction: false,
      imageDir: '/home/someone/Desktop/_stuff/_test/_source',
      dbPath: './data/uatu.db',
    })
  })
```

In `src/config.ts`, add `readonly dbPath: string` to `Config` and this line to the object returned by `loadConfig`:

```ts
    dbPath: env.DB_PATH ?? './data/uatu.db',
```

- [ ] **Step 5: Run and confirm both pass**

Run: `npx vitest run src/db/index.test.ts src/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx vitest run
git add src/db src/config.ts src/config.test.ts
git commit -m "Add SQLite database module and DB_PATH config"
```

---

### Task 4: Tag store

**Files:**
- Create: `src/tags/store.ts`
- Test: `src/tags/store.test.ts`

**Interfaces:**
- Consumes: `openDatabase` (Task 3), `normalizeTagName`/`tagNameError` (Task 2).
- Produces: `interface Tag { id: number; name: string }`, `class DuplicateTagError extends Error`, `class InvalidTagNameError extends Error`, and `listTags(db)`, `createTag(db, rawName)`, `renameTag(db, id, rawName)`, `deleteTag(db, id)`, `tagUsageCount(db, id)`, `tagsForImage(db, imageName)`, `addTagToImage(db, imageName, tagId)`, `removeTagFromImage(db, imageName, tagId)`.

Every function takes the database as its first argument. That is what lets tests pass an in-memory database directly, with no module mocking anywhere.

- [ ] **Step 1: Write the failing test**

```ts
// src/tags/store.test.ts
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/index.js'
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
} from './store.js'

let db: DatabaseSync

beforeEach(() => {
  db = openDatabase(':memory:')
})

describe('createTag', () => {
  it('creates and returns a tag', () => {
    const tag = createTag(db, 'red-birds')

    expect(tag.name).toBe('red-birds')
    expect(tag.id).toBeGreaterThan(0)
  })

  it('normalizes before storing', () => {
    expect(createTag(db, '  Red-Birds  ').name).toBe('red-birds')
  })

  it('rejects a duplicate, including one differing only by case or spacing', () => {
    createTag(db, 'red-birds')

    expect(() => createTag(db, 'red-birds')).toThrow(DuplicateTagError)
    expect(() => createTag(db, '  RED-BIRDS ')).toThrow(DuplicateTagError)
  })

  it('rejects an invalid name', () => {
    expect(() => createTag(db, 'red birds')).toThrow(InvalidTagNameError)
    expect(() => createTag(db, '')).toThrow(InvalidTagNameError)
  })
})

describe('listTags', () => {
  it('returns tags sorted by name', () => {
    createTag(db, 'zebra')
    createTag(db, 'apple')
    createTag(db, 'mango')

    expect(listTags(db).map((t) => t.name)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('returns an empty list when there are none', () => {
    expect(listTags(db)).toEqual([])
  })
})

describe('renameTag', () => {
  it('renames in place, keeping associations', () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)

    const renamed = renameTag(db, tag.id, 'blue-birds')

    expect(renamed.name).toBe('blue-birds')
    expect(tagsForImage(db, 'a.webp').map((t) => t.name)).toEqual(['blue-birds'])
  })

  it('rejects renaming onto an existing name', () => {
    const tag = createTag(db, 'red-birds')
    createTag(db, 'blue-birds')

    expect(() => renameTag(db, tag.id, 'blue-birds')).toThrow(DuplicateTagError)
  })

  it('allows renaming a tag to itself', () => {
    const tag = createTag(db, 'red-birds')

    expect(renameTag(db, tag.id, 'red-birds').name).toBe('red-birds')
  })

  it('rejects an invalid new name', () => {
    const tag = createTag(db, 'red-birds')

    expect(() => renameTag(db, tag.id, 'bad name')).toThrow(InvalidTagNameError)
  })
})

describe('deleteTag', () => {
  it('removes the tag and its associations', () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    addTagToImage(db, 'b.webp', tag.id)

    deleteTag(db, tag.id)

    expect(listTags(db)).toEqual([])
    expect(tagsForImage(db, 'a.webp')).toEqual([])
    expect(tagsForImage(db, 'b.webp')).toEqual([])
  })

  it('does not disturb other tags', () => {
    const doomed = createTag(db, 'red-birds')
    const keeper = createTag(db, 'blue-birds')
    addTagToImage(db, 'a.webp', doomed.id)
    addTagToImage(db, 'a.webp', keeper.id)

    deleteTag(db, doomed.id)

    expect(tagsForImage(db, 'a.webp').map((t) => t.name)).toEqual(['blue-birds'])
  })
})

describe('tagUsageCount', () => {
  it('counts the images carrying a tag', () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)
    addTagToImage(db, 'b.webp', tag.id)

    expect(tagUsageCount(db, tag.id)).toBe(2)
  })

  it('is zero for an unused tag', () => {
    expect(tagUsageCount(db, createTag(db, 'unused').id)).toBe(0)
  })
})

describe('image associations', () => {
  it('applies several tags to one image, sorted by name', () => {
    const a = createTag(db, 'zebra')
    const b = createTag(db, 'apple')
    addTagToImage(db, 'x.webp', a.id)
    addTagToImage(db, 'x.webp', b.id)

    expect(tagsForImage(db, 'x.webp').map((t) => t.name)).toEqual(['apple', 'zebra'])
  })

  it('is idempotent -- applying the same tag twice is not an error', () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'x.webp', tag.id)

    expect(() => addTagToImage(db, 'x.webp', tag.id)).not.toThrow()
    expect(tagsForImage(db, 'x.webp')).toHaveLength(1)
  })

  it('removes a single tag without touching the others', () => {
    const a = createTag(db, 'apple')
    const b = createTag(db, 'zebra')
    addTagToImage(db, 'x.webp', a.id)
    addTagToImage(db, 'x.webp', b.id)

    removeTagFromImage(db, 'x.webp', a.id)

    expect(tagsForImage(db, 'x.webp').map((t) => t.name)).toEqual(['zebra'])
  })

  it('removing a tag that is not applied is a no-op', () => {
    const tag = createTag(db, 'red-birds')

    expect(() => removeTagFromImage(db, 'x.webp', tag.id)).not.toThrow()
  })

  it('keeps images independent', () => {
    const tag = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', tag.id)

    expect(tagsForImage(db, 'b.webp')).toEqual([])
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/tags/store.test.ts`
Expected: FAIL — cannot resolve `./store.js`.

- [ ] **Step 3: Implement**

```ts
// src/tags/store.ts
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
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/tags/store.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add src/tags/store.ts src/tags/store.test.ts
git commit -m "Add tag store with CRUD and image associations"
```

---

### Task 5: Tag manager views and routes

**Files:**
- Create: `src/views/TagManager.tsx`
- Create: `src/routes/tags.tsx`
- Test: `src/routes/tags.test.ts`
- Modify: `src/app.tsx`

**Interfaces:**
- Consumes: the tag store (Task 4), `getDatabase` (Task 3).
- Produces: `tags` — a `Hono` router serving `GET /tags`, `POST /tags`, `POST /tags/:id/rename`, `POST /tags/:id/delete`.

All four return the same fragment: the full tag list plus a create form, with an optional error message. HTMX swaps it into the dialog. Using POST throughout rather than PATCH/DELETE keeps every action expressible as a plain form.

The router is injected with a database getter so tests can supply an in-memory one:

```ts
export function createTagRoutes(getDb: () => DatabaseSync): Hono
export const tags: Hono  // bound to getDatabase()
```

- [ ] **Step 1: Write the failing test**

```ts
// src/routes/tags.test.ts
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/index.js'
import { createTag, listTags, tagsForImage, addTagToImage } from '../tags/store.js'
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
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/routes/tags.test.ts`
Expected: FAIL — cannot resolve `./tags.js`.

- [ ] **Step 3: Write the view**

```tsx
// src/views/TagManager.tsx
import type { Tag } from '../tags/store.js'

export interface TagRow extends Tag {
  readonly usageCount: number
}

/**
 * The whole tag manager as one fragment. Every mutating route re-renders this, so the
 * dialog contents are always a fresh read rather than a client-side patch.
 */
export function TagManager(props: { tags: readonly TagRow[]; error?: string }) {
  return (
    <div id="tag-manager" class="flex w-96 max-w-full flex-col gap-4 p-5">
      <div>
        <h2 class="text-lg font-semibold">Tags</h2>
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          Lowercase words separated by hyphens, like <code>red-birds</code>.
        </p>
      </div>

      {props.error !== undefined && (
        <p
          role="alert"
          class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {props.error}
        </p>
      )}

      <form
        hx-post="/tags"
        hx-target="#tag-manager"
        hx-swap="outerHTML"
        class="flex gap-2"
      >
        <input
          type="text"
          name="name"
          placeholder="new-tag"
          required
          class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="submit"
          class="rounded-md border border-accent px-3 py-2 text-sm text-accent hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark"
        >
          Add
        </button>
      </form>

      <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {props.tags.length === 0 && (
          <li class="py-2 text-sm text-neutral-500 dark:text-neutral-400">No tags yet.</li>
        )}
        {props.tags.map((tag) => (
          <li key={tag.id} class="flex items-center gap-2 border-b border-neutral-200 py-2 dark:border-neutral-700">
            <form
              hx-post={`/tags/${tag.id}/rename`}
              hx-target="#tag-manager"
              hx-swap="outerHTML"
              class="flex flex-1 items-center gap-2"
            >
              <input
                type="text"
                name="name"
                value={tag.name}
                aria-label={`Rename ${tag.name}`}
                class="flex-1 rounded-md border border-transparent px-2 py-1 text-sm hover:border-neutral-300 focus:border-neutral-400 dark:bg-transparent dark:hover:border-neutral-600"
              />
              <span class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {tag.usageCount} images
              </span>
            </form>
            <button
              type="button"
              hx-post={`/tags/${tag.id}/delete`}
              hx-target="#tag-manager"
              hx-swap="outerHTML"
              hx-confirm={`Delete "${tag.name}"? It is used on ${tag.usageCount} images.`}
              aria-label={`Delete ${tag.name}`}
              class="shrink-0 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Write the routes**

```tsx
// src/routes/tags.tsx
import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { getDatabase } from '../db/index.js'
import {
  DuplicateTagError,
  InvalidTagNameError,
  createTag,
  deleteTag,
  listTags,
  renameTag,
  tagUsageCount,
} from '../tags/store.js'
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

  return app
}

export const tags = createTagRoutes(getDatabase)
```

- [ ] **Step 5: Register in the app**

In `src/app.tsx`:

```tsx
import { tags } from './routes/tags.js'
```

```tsx
app.route('/', health)
app.route('/', images)
app.route('/', tags)
app.route('/', gallery)
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npx vitest run
git add -A
git commit -m "Add tag manager routes and view"
```

---

### Task 6: Per-image tag routes

**Files:**
- Create: `src/views/ImageTags.tsx`
- Modify: `src/routes/tags.tsx`
- Modify: `src/routes/tags.test.ts`

**Interfaces:**
- Produces, on the same router: `GET /images/:name/tags`, `POST /images/:name/tags`, `POST /images/:name/tags/:tagId/remove`.

`POST /images/:name/tags` takes a `name` field and **creates the tag if it does not exist**, then applies it — that is the inline-creation behaviour.

**Route collision note.** `/images/:name` (the image file, from `src/routes/images.ts`) and `/images/:name/tags` are distinct paths and do not conflict, because Hono's `:name` does not match across `/`.

- [ ] **Step 1: Add the failing tests**

Append to `src/routes/tags.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/routes/tags.test.ts`
Expected: FAIL — the new routes 404.

- [ ] **Step 3: Write the view**

```tsx
// src/views/ImageTags.tsx
import type { Tag } from '../tags/store.js'

/**
 * The tag panel shown inside the lightbox. Re-rendered whole on every change, and
 * re-fetched by lightbox.js whenever the displayed image changes.
 */
export function ImageTags(props: { imageName: string; tags: readonly Tag[]; error?: string }) {
  const encoded = encodeURIComponent(props.imageName)

  return (
    <div id="image-tags" class="flex flex-col gap-2 p-3">
      <div class="flex flex-wrap gap-2">
        {props.tags.length === 0 && (
          <span class="text-sm text-neutral-400">No tags on this image.</span>
        )}
        {props.tags.map((tag) => (
          <span
            key={tag.id}
            class="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-3 py-1 text-sm text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100"
          >
            {tag.name}
            <button
              type="button"
              hx-post={`/images/${encoded}/tags/${tag.id}/remove`}
              hx-target="#image-tags"
              hx-swap="outerHTML"
              aria-label={`Remove ${tag.name}`}
              class="text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
            >
              &times;
            </button>
          </span>
        ))}
      </div>

      {props.error !== undefined && (
        <p role="alert" class="text-sm text-red-600 dark:text-red-400">
          {props.error}
        </p>
      )}

      <form
        hx-post={`/images/${encoded}/tags`}
        hx-target="#image-tags"
        hx-swap="outerHTML"
        class="flex gap-2"
      >
        <input
          type="text"
          name="name"
          placeholder="add-a-tag"
          required
          class="flex-1 rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="submit"
          class="rounded-md border border-accent px-3 py-1 text-sm text-accent hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark"
        >
          Add
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Add the routes**

Inside `createTagRoutes`, before `return app`:

```tsx
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
```

Extend the imports at the top of `src/routes/tags.tsx`:

```tsx
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
import { normalizeTagName } from '../tags/name.js'
import { ImageTags } from '../views/ImageTags.js'
```

- [ ] **Step 5: Run and confirm they pass**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npx vitest run
git add -A
git commit -m "Add per-image tag routes with inline tag creation"
```

---

### Task 7: Cog menu and lightbox tagging

**Files:**
- Modify: `src/views/Gallery.tsx`
- Modify: `public/lightbox.js`
- Modify: `src/routes/gallery.test.ts`

**Behaviour change:** the cog currently opens the interval dialog directly. It now opens a menu with **Interval** and **Tags**. One existing markup test asserts the old wiring and is updated here.

**The slideshow seam.** `lightbox.js` exposes `window.uatuSlideshow = { pause, resume }`. The tag panel calls `pause()` when it opens and `resume()` when it closes, satisfying "auto-scroll on hold while tagging" without the tag code reaching into the timer.

- [ ] **Step 1: Update the markup tests**

In `src/routes/gallery.test.ts`, replace the `describe('slideshow settings markup contract', ...)` block with:

```ts
describe('cog menu markup contract', () => {
  it('renders a cog button that opens the menu', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="settings-open"')
    expect(body).toContain('aria-label="Settings"')
  })

  it('renders a menu offering Interval and Tags', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="settings-menu"')
    expect(body).toContain('id="menu-interval"')
    expect(body).toContain('id="menu-tags"')
  })

  it('renders the interval dialog, defaulting to 6 seconds', async () => {
    const body = await (await gallery.request('/')).text()
    const input = body.match(/<input id="interval-input"[^>]*>/)![0]

    expect(input).toContain('value="6"')
    expect(input).toContain('min="1"')
    expect(input).toContain('max="60"')
  })

  it('renders an empty tags dialog for HTMX to fill', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="tags-dialog"')
    expect(body).toContain('id="tags-dialog-body"')
  })

  it('renders a tag panel host inside the lightbox', async () => {
    const body = await (await gallery.request('/')).text()

    expect(body).toContain('id="lightbox-tags"')
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/routes/gallery.test.ts -t 'cog menu'`
Expected: FAIL — the menu ids do not exist yet.

- [ ] **Step 3: Update the Gallery view**

Change the cog button's `aria-label` and `title` from `Slideshow settings` to `Settings`.

Add the menu dialog immediately before the existing `<dialog id="settings">`:

```tsx
      <dialog
        id="settings-menu"
        class="m-auto rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div class="flex w-56 flex-col p-2">
          <button
            type="button"
            id="menu-interval"
            class="rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Interval
          </button>
          <button
            type="button"
            id="menu-tags"
            class="rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Tags
          </button>
        </div>
      </dialog>
```

Add the tags dialog after the interval dialog:

```tsx
      <dialog
        id="tags-dialog"
        class="m-auto rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div id="tags-dialog-body" />
      </dialog>
```

Inside the lightbox dialog, add a tag panel host below the image. Replace the lightbox dialog's contents with:

```tsx
        <div class="flex flex-col gap-2">
          <img id="lightbox-image" alt="" class="max-h-[75vh] max-w-[90vw] rounded-lg" />
          <div
            id="lightbox-tags"
            class="rounded-lg bg-white/95 text-neutral-900 dark:bg-neutral-800/95 dark:text-neutral-100"
          />
        </div>
```

- [ ] **Step 4: Update lightbox.js**

Expose the slideshow seam. Immediately after `startAutoplay` is defined, add:

```js
  // Exposed so the tag panel can hold the slideshow while the user types, without
  // reaching into the timer itself.
  window.uatuSlideshow = {
    pause: stopAutoplay,
    resume: function () {
      if (dialog.open) startAutoplay()
    },
  }
```

Load the tag panel whenever the shown image changes. At the end of `show(index)`, add:

```js
    if (window.htmx) {
      window.htmx.ajax('GET', '/images/' + encodeURIComponent(tile.dataset.name) + '/tags', {
        target: '#lightbox-tags',
        swap: 'innerHTML',
      })
    }
```

Hold the slideshow while the user is typing a tag, and resume when they leave. After the lightbox `close` listener, add:

```js
  const tagPanel = document.getElementById('lightbox-tags')
  if (tagPanel) {
    tagPanel.addEventListener('focusin', function () {
      window.uatuSlideshow.pause()
    })
    tagPanel.addEventListener('focusout', function (event) {
      // Only resume once focus has genuinely left the panel, not while moving
      // between the input and the Add button.
      if (!tagPanel.contains(event.relatedTarget)) window.uatuSlideshow.resume()
    })
  }
```

Replace the settings-open handler so the cog opens the menu instead of the interval dialog:

```js
  const menu = document.getElementById('settings-menu')
  const tagsDialog = document.getElementById('tags-dialog')
  const menuInterval = document.getElementById('menu-interval')
  const menuTags = document.getElementById('menu-tags')
  if (!settings || !openSettings || !input || !menu || !tagsDialog) return

  openSettings.addEventListener('click', function () {
    menu.showModal()
  })

  menuInterval.addEventListener('click', function () {
    menu.close()
    input.value = String(readInterval())
    settings.showModal()
  })

  menuTags.addEventListener('click', function () {
    menu.close()
    tagsDialog.showModal()
    if (window.htmx) {
      window.htmx.ajax('GET', '/tags', { target: '#tags-dialog-body', swap: 'innerHTML' })
    }
  })

  // Backdrop click closes either dialog.
  for (const d of [menu, tagsDialog]) {
    d.addEventListener('click', function (event) {
      if (event.target === d) d.close()
    })
  }
```

- [ ] **Step 5: Verify**

```bash
node --check public/lightbox.js
npm run typecheck && npx vitest run
```

Expected: syntax OK, typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add cog menu and lightbox tag panel"
```

---

### Task 8: Persistence in Docker, docs, and verification

**Files:**
- Modify: `Dockerfile`, `README.md`

**The stateful turn.** Until now nothing in the image was stateful, so a replaced container lost nothing. The database changes that: without a mounted volume, every tag disappears when the container is recreated.

- [ ] **Step 1: Give the database a home in the image**

In the runtime stage of `Dockerfile`, before `USER node`:

```dockerfile
# The database lives here. Mount a volume over it or tags are lost when the
# container is replaced: docker run -v uatu-data:/app/data ...
RUN mkdir -p /app/data && chown node:node /app/data
ENV DB_PATH=/app/data/uatu.db
VOLUME /app/data
```

- [ ] **Step 2: Document it**

Add to the README's configuration table:

```markdown
| `DB_PATH` | `./data/uatu.db` | SQLite file for tags |
```

Add a Tagging section after Gallery:

```markdown
## Tagging

Tags are kebab-case (`red-birds`, `great-images`), enforced by
`src/tags/name.ts` on the server — the input pattern is a convenience, not the control.

Storage is `node:sqlite`, built into Node, so tagging added **no dependencies**. Two
tables: `tag`, and `image_tag` joining tag ids to image *filenames*. Filenames rather than
an `image` table means nothing has to be kept in sync with the directory — a file removed
from disk simply stops matching.

`PRAGMA foreign_keys = ON` is set on every connection. SQLite leaves it off by default,
and without it `ON DELETE CASCADE` silently does nothing, so deleting a tag would strand
its associations.

The cog opens a menu: **Interval** for the slideshow, **Tags** to add, rename, and delete.
Deleting warns how many images use the tag. Inside the viewer, a panel adds and removes
tags on the current image; typing a name that does not exist creates it. Focusing that
panel holds the slideshow, via `window.uatuSlideshow.pause()`.

**In Docker, mount a volume at `/app/data`** or tags are lost when the container is
replaced.
```

Also update the Requirements line to note Node 24.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck
npx vitest run
rm -rf dist public/app.css && npm run build
DB_PATH=/tmp/uatu-verify.db PORT=3114 node dist/server.js &
sleep 1
curl -s -o /dev/null -w 'page:        %{http_code}\n' http://127.0.0.1:3114/
curl -s -o /dev/null -w 'tags list:   %{http_code}\n' http://127.0.0.1:3114/tags
curl -s -X POST -d 'name=red-birds' http://127.0.0.1:3114/tags | grep -c 'red-birds'
curl -s -X POST -d 'name=bad name'  http://127.0.0.1:3114/tags | grep -ci 'hyphen'
curl -s -X POST -d 'name=red-birds' http://127.0.0.1:3114/images/a.webp/tags | grep -c 'red-birds'
curl -s http://127.0.0.1:3114/images/a.webp/tags | grep -c 'red-birds'
kill %1
rm -f /tmp/uatu-verify.db
```

Expected: both routes 200, the created tag appears, the invalid name is rejected with the hyphen message, and the tag applied to an image persists across requests.

- [ ] **Step 4: Commit and open a PR**

```bash
git add -A
git commit -m "Document tagging and persist the database in Docker"
git push -u origin feat/tagging
gh pr create --base main --title "Add image tagging"
```

Required checks are now `test (node 24)` and `docker build` — Task 1 removed `test (node 22)`.

---

## Risks

**The Node 22 deadlock.** Covered in Task 1, and it is the single thing most likely to go wrong. Update branch protection *before* opening a PR that changes the CI matrix, or the PR will wait forever on a check that no longer runs.

**Untestable UI, again.** The cog menu, the tag panel's focus handling, and the slideshow hold are browser behaviour. Tests cover the markup contract and the routes; a manual pass is needed for: cog opens a menu, Tags loads the manager, adding and deleting tags works, the viewer's tag panel adds and removes tags, and the slideshow stops while typing and resumes after.

**Orphaned rows.** Deleting an image from disk leaves its `image_tag` rows behind. Harmless — they match nothing — but worth a cleanup routine if the directory churns.

**Phase 2.** Filtering the gallery by tag is deliberately excluded and needs its own plan. `idx_image_tag_tag` exists to serve it.
