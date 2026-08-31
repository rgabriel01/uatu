import { describe, expect, it } from 'vitest'
import { randomSeed, shuffled } from './shuffle.js'

const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('shuffled', () => {
  it('is deterministic for a given seed', () => {
    expect(shuffled(base, 1)).toEqual(shuffled(base, 1))
  })

  it('produces different orders for different seeds', () => {
    expect(shuffled(base, 1)).not.toEqual(shuffled(base, 2))
  })

  it('is a true permutation -- nothing lost, nothing duplicated', () => {
    const out = shuffled(base, 99)
    expect([...out].sort()).toEqual([...base].sort())
    expect(out).toHaveLength(base.length)
  })

  it('does not mutate the input', () => {
    const copy = [...base]
    shuffled(base, 5)
    expect(base).toEqual(copy)
  })

  it('handles empty and single-element lists', () => {
    expect(shuffled([], 1)).toEqual([])
    expect(shuffled(['only'], 1)).toEqual(['only'])
  })

  it('actually reorders a large list', () => {
    const many = Array.from({ length: 500 }, (_, i) => String(i))
    expect(shuffled(many, 7)).not.toEqual(many)
  })
})

describe('randomSeed', () => {
  it('returns a non-negative 32-bit integer', () => {
    for (let i = 0; i < 50; i++) {
      const seed = randomSeed()
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThan(2 ** 32)
    }
  })

  it('varies across calls', () => {
    const seeds = new Set(Array.from({ length: 50 }, () => randomSeed()))
    expect(seeds.size).toBeGreaterThan(1)
  })
})
