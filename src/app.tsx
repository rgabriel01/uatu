import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.js'
import { renderPage } from './render.js'
import { health } from './routes/health.js'
import { gallery } from './routes/gallery.js'
import { images } from './routes/images.js'
import { tags } from './routes/tags.js'
import { Message } from './views/Message.js'

/**
 * The configured application, with no port bound. `server.ts` is the only file that
 * listens; tests drive this object directly via `app.request(...)`.
 */
export const app = new Hono()

// Assets carry no content hash in their filenames, so a browser left to its own
// heuristics will serve a stale stylesheet after a rebuild. `no-cache` makes it
// check with the server every time. This serveStatic answers conditional requests
// with a full 200 rather than a 304, so every check re-sends the file -- a few KB
// off local disk, which is the right trade for never serving a stale build.
app.use('/static/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-cache')
})

// `root` resolves against the process working directory, not this module -- which is
// why the Dockerfile's WORKDIR and its `public/` copy have to agree.
app.use(
  '/static/*',
  serveStatic({
    root: './public',
    rewriteRequestPath: (path) => path.replace(/^\/static/, ''),
  }),
)

app.route('/', health)
app.route('/', images)
app.route('/', tags)
app.route('/', gallery)

app.notFound((c) =>
  renderPage(
    c,
    'Not found - uatu',
    <Message heading="Not found" detail={`No route matches ${c.req.path}.`} />,
    404,
  ),
)

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  const detail = config.isProduction
    ? 'Something went wrong. The error has been logged.'
    : err.message
  return renderPage(
    c,
    'Error - uatu',
    <Message heading="Something went wrong" detail={detail} />,
    500,
  )
})
