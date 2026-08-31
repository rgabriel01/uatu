import { Tile } from './Tile.js'

/**
 * A batch of tiles, optionally followed by a sentinel. HTMX fires the sentinel's
 * request when it scrolls into view, and the response replaces the sentinel with the
 * next batch -- which carries its own sentinel, and so on until nextOffset is null.
 */
export function GridBatch(props: {
  names: readonly string[]
  seed: number
  nextOffset: number | null
}) {
  return (
    <>
      {props.names.map((name) => (
        <Tile key={name} name={name} />
      ))}
      {props.nextOffset !== null && (
        <div
          hx-get={`/gallery?seed=${props.seed}&offset=${props.nextOffset}`}
          hx-trigger="revealed"
          hx-swap="outerHTML"
          class="h-1 w-full"
        />
      )}
    </>
  )
}
