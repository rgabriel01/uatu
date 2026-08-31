import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { config } from './config.js'
import { renderPage } from './render.js'
import { health } from './routes/health.js'
import { home } from './routes/home.js'
import { Message } from './views/Message.js'

/**
 * The configured application, with no port bound. `server.ts` is the only file that
 * listens; tests drive this object directly via `app.request(...)`.
 */
export const app = new Hono()

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
app.route('/', home)

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
