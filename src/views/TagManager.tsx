import type { Tag } from '../tags/store.js'

export interface TagRow extends Tag {
  readonly usageCount: number
}

/**
 * The whole tag manager as one fragment. Every mutating route re-renders this, so the
 * dialog contents are always a fresh read rather than a client-side patch.
 */
export function TagManager(props: { tags: readonly TagRow[]; error?: string }) {
  return (
    <div id="tag-manager" class="flex w-96 max-w-full flex-col gap-4 p-5">
      <div>
        <h2 class="text-lg font-semibold">Tags</h2>
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          Lowercase words separated by hyphens, like <code>red-birds</code>.
        </p>
      </div>

      {props.error !== undefined && (
        <p
          role="alert"
          class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {props.error}
        </p>
      )}

      <form hx-post="/tags" hx-target="#tag-manager" hx-swap="outerHTML" class="flex gap-2">
        <input
          type="text"
          name="name"
          placeholder="new-tag"
          required
          class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="submit"
          class="rounded-md border border-accent px-3 py-2 text-sm text-accent hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark"
        >
          Add
        </button>
      </form>

      <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {props.tags.length === 0 && (
          <li class="py-2 text-sm text-neutral-500 dark:text-neutral-400">No tags yet.</li>
        )}
        {props.tags.map((tag) => (
          <li
            key={tag.id}
            class="flex items-center gap-2 border-b border-neutral-200 py-2 dark:border-neutral-700"
          >
            <form
              hx-post={`/tags/${tag.id}/rename`}
              hx-target="#tag-manager"
              hx-swap="outerHTML"
              class="flex flex-1 items-center gap-2"
            >
              <input
                type="text"
                name="name"
                value={tag.name}
                aria-label={`Rename ${tag.name}`}
                class="flex-1 rounded-md border border-transparent px-2 py-1 text-sm hover:border-neutral-300 dark:bg-transparent dark:hover:border-neutral-600"
              />
              <span class="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {tag.usageCount} images
              </span>
            </form>
            <button
              type="button"
              hx-post={`/tags/${tag.id}/delete`}
              hx-target="#tag-manager"
              hx-swap="outerHTML"
              hx-confirm={`Delete "${tag.name}"? It is used on ${tag.usageCount} images.`}
              aria-label={`Delete ${tag.name}`}
              class="shrink-0 rounded-md px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
