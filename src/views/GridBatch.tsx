import { galleryUrl } from '../gallery/filter.js'
import { Tile } from './Tile.js'

/**
 * A batch of tiles, optionally followed by a sentinel. HTMX fires the sentinel's
 * request when it scrolls into view, and the response replaces the sentinel with the
 * next batch -- which carries its own sentinel, and so on until nextOffset is null.
 *
 * The active tags must be on that URL. Without them, batch two comes from the
 * unfiltered catalog: correct on the first screen, wrong on the second.
 */
export function GridBatch(props: {
  names: readonly string[]
  seed: number
  nextOffset: number | null
  tags: readonly string[]
  untagged: boolean
}) {
  return (
    <>
      {props.names.map((name) => (
        <Tile key={name} name={name} />
      ))}
      {props.nextOffset !== null && (
        <div
          hx-get={galleryUrl('/gallery', {
            seed: props.seed,
            offset: props.nextOffset,
            tags: props.tags,
            untagged: props.untagged,
          })}
          hx-trigger="revealed"
          hx-swap="outerHTML"
          class="h-1 w-full"
        />
      )}
    </>
  )
}
