import { serve } from '@hono/node-server'
import { app } from './app.js'
import { config } from './config.js'

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`uatu listening on http://${config.host}:${info.port} (${config.nodeEnv})`)
})
