import { Hono } from 'hono'
import { config } from '../config.js'
import { readCatalog } from '../gallery/catalog.js'
import { randomSeed, shuffled } from '../gallery/shuffle.js'
import { renderPage } from '../render.js'
import { Gallery } from '../views/Gallery.js'
import { GridBatch } from '../views/GridBatch.js'

/** Images per batch. Small enough for a fast first paint, large enough to fill a screen. */
export const BATCH_SIZE = 60

export const gallery = new Hono()

/**
 * A missing or malformed seed becomes a fresh one rather than an error: the shuffle
 * button deliberately requests /gallery with no seed to mean "give me a new order".
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

async function batch(seed: number, offset: number) {
  const catalog = await readCatalog(config.imageDir)
  const order = shuffled(catalog.names, seed)
  const names = order.slice(offset, offset + BATCH_SIZE)
  const nextOffset = offset + BATCH_SIZE < order.length ? offset + BATCH_SIZE : null

  return { names, nextOffset, total: order.length }
}

gallery.get('/', async (c) => {
  const seed = randomSeed()
  const { names, nextOffset, total } = await batch(seed, 0)

  return renderPage(
    c,
    'uatu',
    <Gallery total={total}>
      <GridBatch names={names} seed={seed} nextOffset={nextOffset} />
    </Gallery>,
  )
})

gallery.get('/gallery', async (c) => {
  const seed = seedFrom(c.req.query('seed'))
  const offset = offsetFrom(c.req.query('offset'))
  const { names, nextOffset } = await batch(seed, offset)

  return c.html(<GridBatch names={names} seed={seed} nextOffset={nextOffset} />)
})
