export function Home(props: { renderedAt: string }) {
  return (
    <main id="app">
      <h1>uatu</h1>
      <p>Server-rendered TypeScript on Hono, with HTMX for interactivity.</p>
      <p>
        Rendered at <time datetime={props.renderedAt}>{props.renderedAt}</time>.
      </p>
      <button hx-get="/" hx-target="#app" hx-swap="outerHTML">
        Re-render from the server
      </button>
    </main>
  )
}
