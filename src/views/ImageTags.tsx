import type { Tag } from '../tags/store.js'

/**
 * The tag panel shown inside the lightbox. Re-rendered whole on every change, and
 * re-fetched by lightbox.js whenever the displayed image changes.
 */
export function ImageTags(props: { imageName: string; tags: readonly Tag[]; error?: string }) {
  const encoded = encodeURIComponent(props.imageName)

  return (
    <div id="image-tags" class="flex flex-col gap-2 p-3">
      <div class="flex flex-wrap gap-2">
        {props.tags.length === 0 && (
          <span class="text-sm text-neutral-400">No tags on this image.</span>
        )}
        {props.tags.map((tag) => (
          <span
            key={tag.id}
            class="inline-flex items-center gap-1 rounded-full bg-neutral-200 px-3 py-1 text-sm text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100"
          >
            {tag.name}
            <button
              type="button"
              hx-post={`/images/${encoded}/tags/${tag.id}/remove`}
              hx-target="#image-tags"
              hx-swap="outerHTML"
              aria-label={`Remove ${tag.name}`}
              class="text-neutral-500 hover:text-red-600 dark:text-neutral-400 dark:hover:text-red-400"
            >
              &times;
            </button>
          </span>
        ))}
      </div>

      {props.error !== undefined && (
        <p role="alert" class="text-sm text-red-600 dark:text-red-400">
          {props.error}
        </p>
      )}

      <form
        hx-post={`/images/${encoded}/tags`}
        hx-target="#image-tags"
        hx-swap="outerHTML"
        class="flex gap-2"
      >
        <input
          type="text"
          name="name"
          placeholder="add-a-tag"
          required
          class="flex-1 rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="submit"
          class="rounded-md border border-accent px-3 py-1 text-sm text-accent hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark"
        >
          Add
        </button>
      </form>
    </div>
  )
}
