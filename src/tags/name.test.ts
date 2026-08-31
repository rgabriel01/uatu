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
