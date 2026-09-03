import { describe, expect, it } from 'vitest'
import { buildGalleryQuery, galleryUrl, parseTagSelection, parseUntagged } from './filter.js'

describe('parseTagSelection', () => {
  it('keeps valid tag names', () => {
    expect(parseTagSelection(['red-birds', 'great-images'])).toEqual([
      'great-images',
      'red-birds',
    ])
  })

  it('sorts so URLs are stable regardless of click order', () => {
    expect(parseTagSelection(['zebra', 'apple'])).toEqual(parseTagSelection(['apple', 'zebra']))
  })

  it('deduplicates', () => {
    expect(parseTagSelection(['red-birds', 'red-birds'])).toEqual(['red-birds'])
  })

  it('normalizes case and surrounding space', () => {
    expect(parseTagSelection([' Red-Birds '])).toEqual(['red-birds'])
  })

  it('drops names that could never be a tag', () => {
    expect(parseTagSelection(['red birds', '', 'ok-tag'])).toEqual(['ok-tag'])
  })

  it('returns an empty array for no input', () => {
    expect(parseTagSelection([])).toEqual([])
  })
})

describe('buildGalleryQuery', () => {
  it('includes seed and offset', () => {
    expect(buildGalleryQuery({ seed: 7, offset: 60, tags: [] })).toBe('seed=7&offset=60')
  })

  it('appends each tag as a repeated parameter', () => {
    expect(buildGalleryQuery({ seed: 7, offset: 0, tags: ['apple', 'zebra'] })).toBe(
      'seed=7&offset=0&tag=apple&tag=zebra',
    )
  })

  it('omits seed and offset when not given', () => {
    expect(buildGalleryQuery({ tags: ['apple'] })).toBe('tag=apple')
  })

  it('returns an empty string when there is nothing to encode', () => {
    expect(buildGalleryQuery({ tags: [] })).toBe('')
  })

  it('escapes tag names', () => {
    expect(buildGalleryQuery({ tags: ['a-b'] })).toBe('tag=a-b')
  })
})

describe('galleryUrl', () => {
  it('joins path and query', () => {
    expect(galleryUrl('/gallery/view', { seed: 7, tags: ['apple'] })).toBe(
      '/gallery/view?seed=7&tag=apple',
    )
  })

  it('omits the question mark when there is nothing to encode', () => {
    expect(galleryUrl('/', { tags: [] })).toBe('/')
    expect(galleryUrl('/gallery/view', { tags: [] })).toBe('/gallery/view')
  })
})

describe('parseUntagged', () => {
  it('is true for 1 and true', () => {
    expect(parseUntagged('1')).toBe(true)
    expect(parseUntagged('true')).toBe(true)
  })

  it('is false when absent', () => {
    expect(parseUntagged(undefined)).toBe(false)
  })

  it('is false for anything else', () => {
    expect(parseUntagged('0')).toBe(false)
    expect(parseUntagged('')).toBe(false)
    expect(parseUntagged('no')).toBe(false)
  })
})

describe('buildGalleryQuery with untagged', () => {
  it('emits untagged=1 when set', () => {
    expect(buildGalleryQuery({ seed: 7, tags: [], untagged: true })).toBe('seed=7&untagged=1')
  })

  it('omits it entirely when false, keeping URLs clean', () => {
    expect(buildGalleryQuery({ seed: 7, tags: [], untagged: false })).toBe('seed=7')
    expect(buildGalleryQuery({ seed: 7, tags: [] })).toBe('seed=7')
  })

  it('places untagged before tags for a stable order', () => {
    expect(buildGalleryQuery({ offset: 60, tags: ['apple'], untagged: true })).toBe(
      'offset=60&untagged=1&tag=apple',
    )
  })

  it('galleryUrl still omits the question mark when nothing is encoded', () => {
    expect(galleryUrl('/', { tags: [], untagged: false })).toBe('/')
    expect(galleryUrl('/', { tags: [], untagged: true })).toBe('/?untagged=1')
  })
})
