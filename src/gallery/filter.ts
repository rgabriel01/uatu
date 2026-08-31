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

export function buildGalleryQuery(params: {
  seed?: number
  offset?: number
  tags: readonly string[]
}): string {
  const parts: string[] = []
  if (params.seed !== undefined) parts.push(`seed=${params.seed}`)
  if (params.offset !== undefined) parts.push(`offset=${params.offset}`)
  for (const tag of params.tags) parts.push(`tag=${encodeURIComponent(tag)}`)
  return parts.join('&')
}

/** Joins a path and query, omitting the `?` when there is nothing to encode. */
export function galleryUrl(
  path: string,
  params: { seed?: number; offset?: number; tags: readonly string[] },
): string {
  const query = buildGalleryQuery(params)
  return query === '' ? path : `${path}?${query}`
}
