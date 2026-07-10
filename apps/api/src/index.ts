import { serve } from '@hono/node-server'
import { createApp } from './app.ts'

const port = Number(process.env.PORT ?? 8787)
const app = createApp()

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[orbital-ops api] listening on http://localhost:${info.port}`)
})
