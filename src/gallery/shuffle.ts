/**
 * mulberry32: a small, fast, seedable PRNG. Chosen over Math.random because the
 * gallery needs the *same* permutation to be reproducible across separate batch
 * requests -- infinite scroll fetches offsets independently, so a per-request
 * random order would repeat some images and omit others entirely.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates, returning a new array. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = makeRng(seed)
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    // `!` is safe: i and j are both in [0, out.length).
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) >>> 0
}
