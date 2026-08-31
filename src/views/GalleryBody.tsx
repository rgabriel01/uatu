import type { Child } from 'hono/jsx'
import type { Tag } from '../tags/store.js'
import { TagFilterBar } from './TagFilterBar.js'

/**
 * Everything that changes when the filter changes: the chips, the count, and the
 * grid. Swapped as one unit so they can never disagree.
 */
export function GalleryBody(props: {
  allTags: readonly Tag[]
  activeTags: readonly string[]
  matchCount: number
  seed: number
  children?: Child
}) {
  return (
    <div id="gallery-body">
      <TagFilterBar
        allTags={props.allTags}
        activeTags={props.activeTags}
        matchCount={props.matchCount}
        seed={props.seed}
      />
      <div id="grid" class="columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5">
        {props.children}
      </div>
    </div>
  )
}
