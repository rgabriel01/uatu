import type { Child } from 'hono/jsx'

/**
 * The gallery page body. The grid is a CSS multi-column layout rather than a grid,
 * which lets tiles of differing heights pack without cropping or fixed aspect ratios.
 */
export function Gallery(props: { total: number; children?: Child }) {
  return (
    <main id="app" class="mx-auto max-w-7xl px-4 py-8">
      <header class="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">uatu</h1>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">{props.total} images</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            id="settings-open"
            aria-label="Settings"
            title="Settings"
            class="rounded-md border border-neutral-300 p-2 text-neutral-600 transition hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            hx-get="/gallery"
            hx-target="#grid"
            hx-swap="innerHTML"
            class="rounded-md border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark dark:hover:bg-accent-dark dark:hover:text-neutral-900"
          >
            Shuffle
          </button>
        </div>
      </header>

      <div id="grid" class="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {props.children}
      </div>

      <dialog
        id="settings-menu"
        class="m-auto rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div class="flex w-56 flex-col p-2">
          <button
            type="button"
            id="menu-interval"
            class="rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Interval
          </button>
          <button
            type="button"
            id="menu-tags"
            class="rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Tags
          </button>
        </div>
      </dialog>

      <dialog
        id="settings"
        class="m-auto rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <form method="dialog" class="flex w-72 flex-col gap-4 p-5">
          <div>
            <h2 class="text-lg font-semibold">Slideshow</h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              How long each image is shown while the viewer is open.
            </p>
          </div>
          <label class="flex flex-col gap-1 text-sm" for="interval-input">
            Seconds between images
            <input
              id="interval-input"
              name="interval"
              type="number"
              min="1"
              max="60"
              step="1"
              value="6"
              class="rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-600 dark:bg-neutral-900"
            />
          </label>
          <div class="flex justify-end gap-2">
            <button
              type="submit"
              value="cancel"
              class="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              value="save"
              id="settings-save"
              class="rounded-md border border-accent px-3 py-2 text-sm text-accent hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark"
            >
              Save
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        id="tags-dialog"
        class="m-auto rounded-lg bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div id="tags-dialog-body" />
      </dialog>

      <dialog
        id="lightbox"
        class="m-auto max-h-[90vh] max-w-[90vw] bg-transparent p-0 backdrop:bg-black/80"
      >
        <div class="flex flex-col gap-2">
          <img id="lightbox-image" alt="" class="max-h-[75vh] max-w-[90vw] rounded-lg" />
          <div
            id="lightbox-tags"
            class="rounded-lg bg-white/95 text-neutral-900 dark:bg-neutral-800/95 dark:text-neutral-100"
          />
        </div>
      </dialog>
    </main>
  )
}
