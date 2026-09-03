import { galleryUrl } from '../gallery/filter.js'
import type { Tag } from '../tags/store.js'

function toggled(active: readonly string[], name: string): string[] {
  return active.includes(name) ? active.filter((t) => t !== name) : [...active, name].sort()
}

const ACTIVE_CHIP =
  'rounded-full border border-accent bg-accent px-3 py-1 text-sm text-white dark:border-accent-dark dark:bg-accent-dark dark:text-neutral-900'
const IDLE_CHIP =
  'rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
const IDLE_UNTAGGED_CHIP =
  'rounded-full border border-dashed border-neutral-400 px-3 py-1 text-sm text-neutral-600 hover:border-neutral-500 dark:border-neutral-500 dark:text-neutral-400'

/**
 * Chip bar plus the result count. Lives inside #gallery-body with the grid, so one
 * swap keeps the chips, the count, and the images consistent with each other.
 *
 * Untagged and tag chips are mutually exclusive: an image carrying a tag is never
 * untagged, so allowing both would only ever produce an empty grid. Each chip's link
 * therefore clears the other mode rather than adding to it.
 */
export function TagFilterBar(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  untagged: boolean
  matchCount: number
  seed: number
}) {
  const active = props.activeTags
  const anyFilter = props.untagged || active.length > 0

  return (
    <div class="mb-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          id="untagged-chip"
          type="button"
          hx-get={galleryUrl('/gallery/view', {
            seed: props.seed,
            tags: [],
            untagged: !props.untagged,
          })}
          hx-target="#gallery-body"
          hx-swap="outerHTML"
          hx-push-url={galleryUrl('/', { tags: [], untagged: !props.untagged })}
          aria-pressed={props.untagged ? 'true' : 'false'}
          class={props.untagged ? ACTIVE_CHIP : IDLE_UNTAGGED_CHIP}
        >
          Untagged
        </button>

        {props.allTags.map((tag) => {
          const next = toggled(active, tag.name)
          const isActive = active.includes(tag.name)
          return (
            <button
              key={tag.id}
              type="button"
              hx-get={galleryUrl('/gallery/view', {
                seed: props.seed,
                tags: next,
                untagged: false,
              })}
              hx-target="#gallery-body"
              hx-swap="outerHTML"
              hx-push-url={galleryUrl('/', { tags: next, untagged: false })}
              aria-pressed={isActive ? 'true' : 'false'}
              class={isActive ? ACTIVE_CHIP : IDLE_CHIP}
            >
              {tag.name}
            </button>
          )
        })}

        {anyFilter && (
          <button
            type="button"
            id="clear-filter"
            hx-get={galleryUrl('/gallery/view', { seed: props.seed, tags: [], untagged: false })}
            hx-target="#gallery-body"
            hx-swap="outerHTML"
            hx-push-url="/"
            class="rounded-full px-3 py-1 text-sm text-neutral-500 underline hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Clear
          </button>
        )}
      </div>

      <p id="result-count" class="text-sm text-neutral-500 dark:text-neutral-400">
        {props.matchCount} images
        {props.untagged && ' with no tags'}
        {!props.untagged &&
          active.length > 0 &&
          ` matching ${active.length} ${active.length === 1 ? 'tag' : 'tags'}`}
      </p>
    </div>
  )
}
