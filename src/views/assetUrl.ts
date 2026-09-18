import { statSync } from 'node:fs'

/**
 * Appends the file's modification time to an asset URL, so a rebuilt stylesheet or
 * script arrives under a URL the browser has never seen. `Cache-Control: no-cache`
 * only governs entries stored from then on; a copy already sitting in the cache can
 * still be treated as fresh, which is what this defeats.
 *
 * Stats on every call rather than caching: the dev server rewrites these files while
 * the process runs, and one stat per page render is not worth the staleness risk.
 */
export function assetUrl(path: string): string {
  try {
    const stamp = statSync(`./public${path}`).mtimeMs
    return `/static${path}?v=${Math.round(stamp)}`
  } catch {
    // Missing file: let the request 404 on its own rather than breaking the page.
    return `/static${path}`
  }
}
