# uatu — TypeScript Web Application Scaffold

**Date:** 2026-08-31
**Status:** Approved

## Purpose

Stand up the initial structure for `uatu`: a server-rendered TypeScript web application
that is cheap to develop in and portable across hosts. The scaffold is not a feature — it
is the set of conventions every later feature will follow. Its success criterion is that a
new route, a new view, and a new test can each be added by copying an existing one.

## Constraints

- **Runtime:** Node. `engines` declares `>=22`, CI verifies against 22 and 24, and the
  Docker image pins 24 LTS. Node 25 is what's installed locally and works fine for
  development, but nothing pins to a non-LTS line.
- **Rendering:** Server-rendered HTML. Interactivity via HTMX fragments, not a client-side
  framework.
- **Persistence:** None. No database, no ORM, no migrations. Added when there is something
  to store.
- **Dependency weight:** Two runtime dependencies, four dev dependencies. Additions past
  that need a reason.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| HTTP | Hono + `@hono/node-server` | ~14KB, strong TS inference, and the same handlers run on Bun/Deno/Workers/Lambda by swapping the adapter import |
| Templating | Hono JSX (`hono/jsx`) | Server-renders JSX to a string; no React runtime reaches the browser |
| Interactivity | HTMX, vendored | No CDN dependency at runtime; works offline and behind locked-down networks |
| Tests | Vitest | Fast, TS-native, no config needed for this shape |
| Dev runner | `tsx` watch | Node strips types natively but does **not** transform JSX, so a transform is required |
| Build | `tsc` → `dist/` | Plain output, no bundler to age out |

### Note on the build step

Node's native TypeScript support strips type annotations only. JSX is a syntax extension,
not type syntax, so `.tsx` files must be transformed. `tsx` handles this in development and
`tsc` handles it for the production build. There is no bundler.

## Layout

```
src/
  app.tsx           Builds and exports the Hono app. Does not listen.
  server.ts         Entry point. Imports app, binds HOST:PORT.
  config.ts         Env parsing with defaults. Throws at startup on invalid input.
  render.tsx        renderPage() — chooses full page vs bare fragment.
  routes/
    home.tsx        GET /
    health.ts       GET /health
  views/
    Layout.tsx      HTML shell: head, vendored htmx script, children slot.
    Home.tsx        Home page body.
    Message.tsx     Shared shell for 404 and 500 responses.
public/
  styles.css
  vendor/htmx.min.js
docs/superpowers/specs/
Dockerfile
.github/workflows/ci.yml
```

### Why `app.tsx` and `server.ts` are separate

`app.tsx` exports a configured Hono app that has never bound a port. `server.ts` is the only
file that listens. This is the entire testing strategy: Vitest calls `app.request('/')`
against the app object directly, so tests open no sockets, need no supertest, and cannot
flake on port collisions or teardown races.

## Data flow

1. Request enters the Hono router.
2. The matched handler builds a JSX view.
3. `renderPage(c, title, <Home />)` inspects the `HX-Request` header:
   - absent → wrap in `Layout` and return a full HTML document
   - present → return the bare fragment
4. Hono's JSX renderer produces an HTML string; the handler returns it via `c.html()`.

HTMX requests hit the same routes as full page loads. Establishing this in the scaffold
matters because retrofitting the fragment branch later means editing every route.

## Module conventions

- ESM throughout (`"type": "module"`).
- `tsconfig` uses `module: "nodenext"`, so **relative imports carry explicit `.js`
  extensions** even though the source files are `.ts`/`.tsx`. This is required for the
  emitted output to resolve under Node ESM.
- `strict: true`, plus `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- `jsx: "react-jsx"` with `jsxImportSource: "hono/jsx"`.

## Configuration

`config.ts` exports a pure `loadConfig(env)` plus a module-level `config = loadConfig(process.env)`.
Validation therefore happens at import time -- a misconfigured deploy fails immediately and
loudly rather than 500-ing on first request -- while `loadConfig` stays directly testable
against a fabricated environment, without touching real process state.

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | Must parse as an integer in 1–65535 |
| `HOST` | `0.0.0.0` | Binding to all interfaces is required inside a container |
| `NODE_ENV` | `development` | One of `development`, `production`, `test` |

## Static assets

Mounted at `/static/*` via `serveStatic` with a path rewrite stripping the `/static`
prefix, reading from `./public`. The `root` option resolves relative to the process working
directory, not the module — so the Dockerfile's `WORKDIR` and the `public/` copy must agree.

## Error handling

- `app.onError` — logs the error server-side, returns a 500. Never leaks a stack trace to
  the client in production.
- `app.notFound` — returns a 404 page.
- Both respect the fragment-vs-page distinction via `renderPage`, so an HTMX swap that
  fails gets an error fragment rather than a nested `<html>` document.
- `config.ts` throws at startup on invalid env.

## Testing

Vitest, with tests colocated as `*.test.ts` beside the code they cover. The scaffold ships
with real assertions, not placeholders:

- `GET /` returns 200 and a full HTML document.
- `GET /` with `HX-Request: true` returns 200 and a fragment containing no `<html>` tag.
- `GET /health` returns 200 and JSON with `status: "ok"`.
- An unknown path returns 404.
- `loadConfig` throws on a non-numeric `PORT`, an out-of-range `PORT`, and an unknown
  `NODE_ENV`.

These exist to prove the harness runs and to be the pattern later tests are copied from.

## Deployment

**Dockerfile** — multi-stage on `node:24-alpine`. Builder stage runs `npm ci` and
`npm run build`; the runtime stage installs production dependencies only, copies `dist/`
and `public/`, runs as the non-root `node` user, exposes 3000, and declares a `HEALTHCHECK`
against `/health`.

**CI** — GitHub Actions on push and pull request. A matrix across Node 22 and 24 runs
`npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. A separate job builds the
Docker image to catch Dockerfile breakage without publishing it anywhere.

## Explicitly out of scope

Authentication, sessions, database, logging framework, metrics, and rate limiting. Each is
a real decision that deserves its own design when there is a concrete need driving it.

A CSS framework was originally out of scope here; Tailwind v4 was added afterwards on
request. See the Styling section of the README.

## Implementation notes

Deviations from the design as written, recorded after building it:

- Files containing JSX must carry the `.tsx` extension, so `app.ts` became `app.tsx` and
  `routes/home.ts` became `routes/home.tsx`. Non-JSX modules stayed `.ts`.
- `views/Message.tsx` was added as a shared shell for the 404 and 500 responses. It reuses
  the `#app` id that `Home` uses, so an HTMX swap landing on an error still targets correctly.
- Hono's JSX renderer does not emit a doctype, so `Layout` prepends one explicitly via
  `raw('<!DOCTYPE html>')`.
- `tsconfig.json` needs `types: ["node"]` explicitly; without it `process` and `console` do
  not resolve. Build exclusions live in `tsconfig.build.json` so `typecheck` still covers tests.
