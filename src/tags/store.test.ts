import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db/index.js'
import {
  DuplicateTagError,
  InvalidTagNameError,
  addTagToImage,
  createTag,
  deleteTag,
  imageNamesWithAllTags,
  listTags,
  removeTagFromImage,
  renameTag,
  taggedImageNames,
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

describe('imageNamesWithAllTags', () => {
  beforeEach(() => {
    const red = createTag(db, 'red-birds')
    const great = createTag(db, 'great-images')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', great.id)
    addTagToImage(db, 'b.webp', red.id)
    addTagToImage(db, 'c.webp', great.id)
    addTagToImage(db, 'c.webp', blue.id)
  })

  it('returns every image carrying a single tag', () => {
    expect([...imageNamesWithAllTags(db, ['red-birds'])].sort()).toEqual(['a.webp', 'b.webp'])
  })

  it('requires ALL tags, not any -- this is AND, not OR', () => {
    expect([...imageNamesWithAllTags(db, ['red-birds', 'great-images'])]).toEqual(['a.webp'])
  })

  it('narrows further with each additional tag', () => {
    const one = imageNamesWithAllTags(db, ['great-images'])
    const two = imageNamesWithAllTags(db, ['great-images', 'blue-sky'])

    expect(one.size).toBe(2)
    expect(two.size).toBe(1)
  })

  it('returns nothing for an unknown tag', () => {
    expect(imageNamesWithAllTags(db, ['nope']).size).toBe(0)
  })

  it('returns nothing when one of several tags is unknown', () => {
    expect(imageNamesWithAllTags(db, ['red-birds', 'nope']).size).toBe(0)
  })

  it('ignores a repeated tag rather than returning nothing', () => {
    // A naive HAVING COUNT(...) = ? compares against the number of bound
    // parameters, so a duplicate silently breaks a legitimate filter.
    expect([...imageNamesWithAllTags(db, ['red-birds', 'red-birds'])].sort()).toEqual([
      'a.webp',
      'b.webp',
    ])
  })

  it('returns an empty set for an empty selection -- callers must skip instead', () => {
    expect(imageNamesWithAllTags(db, []).size).toBe(0)
  })
})

describe('taggedImageNames', () => {
  it('returns an empty set when nothing is tagged', () => {
    expect(taggedImageNames(db).size).toBe(0)
  })

  it('returns each image carrying at least one tag, once', () => {
    const red = createTag(db, 'red-birds')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', blue.id)
    addTagToImage(db, 'b.webp', red.id)

    expect([...taggedImageNames(db)].sort()).toEqual(['a.webp', 'b.webp'])
  })

  it('keeps an image tagged when only one of its tags is removed', () => {
    const red = createTag(db, 'red-birds')
    const blue = createTag(db, 'blue-sky')
    addTagToImage(db, 'a.webp', red.id)
    addTagToImage(db, 'a.webp', blue.id)

    removeTagFromImage(db, 'a.webp', red.id)

    expect(taggedImageNames(db).has('a.webp')).toBe(true)
  })

  it('drops an image once its last tag is removed', () => {
    const red = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', red.id)

    removeTagFromImage(db, 'a.webp', red.id)

    expect(taggedImageNames(db).has('a.webp')).toBe(false)
  })

  it('drops associations when the tag itself is deleted', () => {
    const red = createTag(db, 'red-birds')
    addTagToImage(db, 'a.webp', red.id)

    deleteTag(db, red.id)

    expect(taggedImageNames(db).size).toBe(0)
  })
})
