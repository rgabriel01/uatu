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
