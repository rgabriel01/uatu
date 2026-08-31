import { galleryUrl } from '../gallery/filter.js'
import type { Tag } from '../tags/store.js'

function toggled(active: readonly string[], name: string): string[] {
  return active.includes(name) ? active.filter((t) => t !== name) : [...active, name].sort()
}

/**
 * Chip bar plus the result count. Lives inside #gallery-body with the grid, so one
 * swap keeps the chips, the count, and the images consistent with each other.
 */
export function TagFilterBar(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  matchCount: number
  seed: number
}) {
  const active = props.activeTags

  return (
    <div class="mb-4 flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        {props.allTags.map((tag) => {
          const next = toggled(active, tag.name)
          const isActive = active.includes(tag.name)
          return (
            <button
              key={tag.id}
              type="button"
              hx-get={galleryUrl('/gallery/view', { seed: props.seed, tags: next })}
              hx-target="#gallery-body"
              hx-swap="outerHTML"
              hx-push-url={galleryUrl('/', { tags: next })}
              aria-pressed={isActive ? 'true' : 'false'}
              class={
                isActive
                  ? 'rounded-full border border-accent bg-accent px-3 py-1 text-sm text-white dark:border-accent-dark dark:bg-accent-dark dark:text-neutral-900'
                  : 'rounded-full border border-neutral-300 px-3 py-1 text-sm text-neutral-700 hover:border-neutral-400 dark:border-neutral-600 dark:text-neutral-300'
              }
            >
              {tag.name}
            </button>
          )
        })}

        {active.length > 0 && (
          <button
            type="button"
            id="clear-filter"
            hx-get={galleryUrl('/gallery/view', { seed: props.seed, tags: [] })}
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
        {active.length > 0 && ` matching ${active.length} ${active.length === 1 ? 'tag' : 'tags'}`}
      </p>
    </div>
  )
}
