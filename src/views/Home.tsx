export function Home(props: { renderedAt: string }) {
  return (
    <main id="app" class="mx-auto max-w-2xl px-6 py-12">
      <h1 class="text-3xl font-semibold tracking-tight">uatu</h1>
      <p class="mt-2">Server-rendered TypeScript on Hono, with HTMX for interactivity.</p>
      <p class="mt-2 text-neutral-500 dark:text-neutral-400">
        Rendered at{' '}
        <time datetime={props.renderedAt} class="tabular-nums">
          {props.renderedAt}
        </time>
        .
      </p>
      <button
        hx-get="/"
        hx-target="#app"
        hx-swap="outerHTML"
        class="mt-6 rounded-md border border-accent px-4 py-2 text-accent transition hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark dark:hover:bg-accent-dark dark:hover:text-neutral-900"
      >
        Re-render from the server
      </button>
    </main>
  )
}
