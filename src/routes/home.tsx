import { Hono } from 'hono'
import { renderPage } from '../render.js'
import { Home } from '../views/Home.js'

export const home = new Hono()

home.get('/', (c) => renderPage(c, 'uatu', <Home renderedAt={new Date().toISOString()} />))
