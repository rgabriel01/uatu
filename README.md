# uatu

A server-rendered TypeScript web application: [Hono](https://hono.dev) for routing,
Hono's JSX renderer for templating, and [HTMX](https://htmx.org) for interactivity.
No client-side framework, no database, no bundler.

## Requirements

Node 22 or newer.

## Getting started

```sh
npm install
npm run dev      # http://localhost:3000, restarts on change
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Watch mode via `tsx` |
| `npm run build` | Compiles to `dist/` with `tsc` |
| `npm start` | Runs the compiled server |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc --noEmit` |

## Configuration

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | Integer, 1-65535 |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

Invalid values throw at startup rather than failing on a later request.

## Layout

```
src/
  app.tsx        Hono app + routes. Exported without binding a port.
  server.ts      Entry point. The only file that listens.
  config.ts      Env parsing, validated at import time.
  render.tsx     renderPage() -- full document vs HTMX fragment.
  routes/        One module per route group.
  views/         JSX components.
public/          Static assets, served at /static/*.
```

### Two conventions worth knowing

**`app` never listens.** `app.tsx` exports a configured Hono app with no port bound;
`server.ts` binds it. Tests therefore call `app.request('/')` directly against the app
object -- no sockets, no supertest, no port collisions.

**Every response goes through `renderPage`.** It checks the `HX-Request` header and
returns either a full document or a bare fragment. Adding a route means calling
`renderPage`, not `c.html` directly, so the two paths can't drift apart.

### Adding a route

1. Add a handler in `src/routes/`, returning `renderPage(c, title, <View />)`.
2. Register it in `src/app.tsx` with `app.route('/', yourRouter)`.
3. Add a test in `src/*.test.ts` using `app.request(...)`.

## Notes

- TypeScript is compiled, not type-stripped: Node strips type annotations natively but
  does not transform JSX, so `.tsx` files need `tsx` in dev and `tsc` for the build.
- Relative imports carry explicit `.js` extensions. This is required by `module: nodenext`
  for the emitted output to resolve under Node ESM, even though the sources are `.ts`/`.tsx`.
- HTMX is vendored into `public/vendor/` rather than loaded from a CDN, so the app has no
  external runtime dependency.

## Deployment

`docker build -t uatu . && docker run -p 3000:3000 uatu`, or build and run `dist/` on any
host with Node. Because Hono is runtime-agnostic, moving to Bun, Deno, Cloudflare Workers,
or Lambda means swapping the adapter in `server.ts` -- the routes and views are unchanged.

## Design

See [`docs/superpowers/specs/`](docs/superpowers/specs/).
