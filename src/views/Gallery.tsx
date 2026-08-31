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
        <button
          type="button"
          hx-get="/gallery"
          hx-target="#grid"
          hx-swap="innerHTML"
          class="rounded-md border border-accent px-4 py-2 text-sm text-accent transition hover:bg-accent hover:text-white dark:border-accent-dark dark:text-accent-dark dark:hover:bg-accent-dark dark:hover:text-neutral-900"
        >
          Shuffle
        </button>
      </header>

      <div id="grid" class="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {props.children}
      </div>

      <dialog
        id="lightbox"
        class="m-auto max-h-[90vh] max-w-[90vw] bg-transparent p-0 backdrop:bg-black/80"
      >
        <img id="lightbox-image" alt="" class="max-h-[90vh] max-w-[90vw] rounded-lg" />
      </dialog>
    </main>
  )
}
