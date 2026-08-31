import type { Context } from 'hono'
import type { Child } from 'hono/jsx'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { Layout } from './views/Layout.js'

/**
 * HTMX sets this header on every request it issues, which is how a handler tells a
 * fragment swap apart from a full page load.
 */
export function isFragmentRequest(c: Context): boolean {
  return c.req.header('HX-Request') === 'true'
}

/**
 * The single place that decides between a full document and a bare fragment. Every
 * route goes through here so the two paths can never drift apart.
 */
export function renderPage(
  c: Context,
  title: string,
  body: Child,
  status: ContentfulStatusCode = 200,
) {
  const markup = isFragmentRequest(c) ? <>{body}</> : <Layout title={title}>{body}</Layout>
  return c.html(markup, status)
}
