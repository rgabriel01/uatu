import { normalizeTagName, tagNameError } from '../tags/name.js'

/**
 * Normalizes, drops anything that could not be a tag, deduplicates, and sorts.
 *
 * Sorting keeps URLs stable so the same selection is always the same page, and
 * deduplication protects the AND query, whose HAVING count would otherwise never be
 * satisfiable when a tag is repeated.
 */
export function parseTagSelection(raw: readonly string[]): string[] {
  const names = raw.map(normalizeTagName).filter((name) => tagNameError(name) === null)
  return [...new Set(names)].sort()
}

/** Accepts the values a link or form would realistically produce; anything else is false. */
export function parseUntagged(raw: string | undefined): boolean {
  return raw === '1' || raw === 'true'
}

export function buildGalleryQuery(params: {
  seed?: number
  offset?: number
  tags: readonly string[]
  untagged?: boolean
}): string {
  const parts: string[] = []
  if (params.seed !== undefined) parts.push(`seed=${params.seed}`)
  if (params.offset !== undefined) parts.push(`offset=${params.offset}`)
  // Emitted only when true, so an unfiltered URL carries no trace of it.
  if (params.untagged === true) parts.push('untagged=1')
  for (const tag of params.tags) parts.push(`tag=${encodeURIComponent(tag)}`)
  return parts.join('&')
}

/** Joins a path and query, omitting the `?` when there is nothing to encode. */
export function galleryUrl(
  path: string,
  params: { seed?: number; offset?: number; tags: readonly string[]; untagged?: boolean },
): string {
  const query = buildGalleryQuery(params)
  return query === '' ? path : `${path}?${query}`
}
