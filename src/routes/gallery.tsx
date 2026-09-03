import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { config } from '../config.js'
import { getDatabase } from '../db/index.js'
import { readCatalog } from '../gallery/catalog.js'
import { parseTagSelection, parseUntagged } from '../gallery/filter.js'
import { randomSeed, shuffled } from '../gallery/shuffle.js'
import { renderPage } from '../render.js'
import { imageNamesWithAllTags, listTags, taggedImageNames } from '../tags/store.js'
import { Gallery } from '../views/Gallery.js'
import { GalleryBody } from '../views/GalleryBody.js'
import { GridBatch } from '../views/GridBatch.js'

/** Images per batch. Small enough for a fast first paint, large enough to fill a screen. */
export const BATCH_SIZE = 60

/**
 * A missing or malformed seed becomes a fresh one rather than an error: the shuffle
 * button deliberately requests without a seed to mean "give me a new order".
 */
function seedFrom(raw: string | undefined): number {
  if (raw === undefined) return randomSeed()
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : randomSeed()
}

function offsetFrom(raw: string | undefined): number {
  const parsed = Number(raw ?? 0)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export function createGalleryRoutes(getDb: () => DatabaseSync): Hono {
  const app = new Hono()

  /**
   * Filtering happens BEFORE shuffling so the permutation is over the filtered list.
   * Shuffling first and filtering after would make each batch an uneven slice of the
   * unfiltered order.
   *
   * `untagged` takes precedence over tags: the two are mutually exclusive, and a
   * request carrying both is a hand-edited or stale URL rather than a real intent.
   */
  async function select(
    seed: number,
    tags: readonly string[],
    untagged: boolean,
  ): Promise<string[]> {
    const catalog = await readCatalog(config.imageDir)

    let names: readonly string[] = catalog.names
    if (untagged) {
      const tagged = taggedImageNames(getDb())
      names = names.filter((name) => !tagged.has(name))
    } else if (tags.length > 0) {
      const allowed = imageNamesWithAllTags(getDb(), tags)
      names = names.filter((name) => allowed.has(name))
    }

    return shuffled(names, seed)
  }

  function batchOf(order: readonly string[], offset: number) {
    return {
      names: order.slice(offset, offset + BATCH_SIZE),
      nextOffset: offset + BATCH_SIZE < order.length ? offset + BATCH_SIZE : null,
    }
  }

  app.get('/', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const untagged = parseUntagged(c.req.query('untagged'))
    const seed = randomSeed()
    const order = await select(seed, tags, untagged)
    const { names, nextOffset } = batchOf(order, 0)

    return renderPage(
      c,
      'uatu',
      <Gallery activeTags={tags} untagged={untagged}>
        <GalleryBody
          allTags={listTags(getDb())}
          activeTags={tags}
          untagged={untagged}
          matchCount={order.length}
          seed={seed}
        >
          <GridBatch
            names={names}
            seed={seed}
            nextOffset={nextOffset}
            tags={tags}
            untagged={untagged}
          />
        </GalleryBody>
      </Gallery>,
    )
  })

  app.get('/gallery/view', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const untagged = parseUntagged(c.req.query('untagged'))
    const seed = seedFrom(c.req.query('seed'))
    const order = await select(seed, tags, untagged)
    const { names, nextOffset } = batchOf(order, 0)

    return c.html(
      <GalleryBody
        allTags={listTags(getDb())}
        activeTags={tags}
        untagged={untagged}
        matchCount={order.length}
        seed={seed}
      >
        <GridBatch
            names={names}
            seed={seed}
            nextOffset={nextOffset}
            tags={tags}
            untagged={untagged}
          />
      </GalleryBody>,
    )
  })

  app.get('/gallery', async (c) => {
    const tags = parseTagSelection(c.req.queries('tag') ?? [])
    const untagged = parseUntagged(c.req.query('untagged'))
    const seed = seedFrom(c.req.query('seed'))
    const offset = offsetFrom(c.req.query('offset'))
    const order = await select(seed, tags, untagged)
    const { names, nextOffset } = batchOf(order, offset)

    return c.html(<GridBatch
            names={names}
            seed={seed}
            nextOffset={nextOffset}
            tags={tags}
            untagged={untagged}
          />)
  })

  return app
}

export const gallery = createGalleryRoutes(getDatabase)
