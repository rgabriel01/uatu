import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'

/**
 * The full HTML document. Only ever used for non-HTMX requests -- see `renderPage`.
 */
export function Layout(props: { title: string; children?: Child }) {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title}</title>
          <link rel="stylesheet" href="/static/app.css" />
          <script src="/static/vendor/htmx.min.js" defer></script>
          <script src="/static/lightbox.js" defer></script>
        </head>
        <body class="bg-white text-neutral-900 antialiased dark:bg-neutral-900 dark:text-neutral-100">
          {props.children}
        </body>
      </html>
    </>
  )
}
