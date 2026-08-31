/**
 * Shared shell for 404 and 500 responses. Uses the same `#app` id as `Home` so an
 * HTMX swap that lands on an error still targets correctly.
 */
export function Message(props: { heading: string; detail: string }) {
  return (
    <main id="app">
      <h1>{props.heading}</h1>
      <p>{props.detail}</p>
      <p>
        <a href="/">Back to the home page</a>
      </p>
    </main>
  )
}
