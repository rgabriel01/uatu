/**
 * One image. `data-name` is the hook the lightbox uses to identify which image was
 * clicked without re-parsing the src.
 */
export function Tile(props: { name: string }) {
  return (
    <img
      src={`/images/${encodeURIComponent(props.name)}`}
      alt={props.name}
      data-name={props.name}
      loading="lazy"
      decoding="async"
      class="mb-3 w-full cursor-zoom-in rounded-lg break-inside-avoid bg-neutral-100 transition hover:opacity-90 dark:bg-neutral-800"
    />
  )
}
