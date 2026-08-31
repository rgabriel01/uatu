/**
 * Shared shell for 404 and 500 responses. Uses the same `#app` id as `Home` so an
 * HTMX swap that lands on an error still targets correctly.
 */
export function Message(props: { heading: string; detail: string }) {
  return (
    <main id="app" class="mx-auto max-w-2xl px-6 py-12">
      <h1 class="text-3xl font-semibold tracking-tight">{props.heading}</h1>
      <p class="mt-2 text-neutral-500 dark:text-neutral-400">{props.detail}</p>
      <p class="mt-6">
        <a href="/" class="text-accent underline dark:text-accent-dark">
          Back to the home page
        </a>
      </p>
    </main>
  )
}
