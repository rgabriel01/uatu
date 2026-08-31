import { describe, expect, it } from 'vitest'
import { buildGalleryQuery, galleryUrl, parseTagSelection } from './filter.js'

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
