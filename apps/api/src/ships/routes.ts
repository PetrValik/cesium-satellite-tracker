import { Hono } from 'hono'
import type { AisFeed } from './ais.ts'

export interface ShipRoutesDeps {
  ais?: AisFeed
}

export function shipRoutes({ ais }: ShipRoutesDeps): Hono {
  const app = new Hono()

  app.get('/api/ships', (c) => {
    if (!ais || !ais.status().configured) {
      return c.json({ error: 'AIS feed not configured (set AISSTREAM_API_KEY)' }, 503)
    }
    c.header('Cache-Control', 'public, max-age=5')
    return c.json(ais.snapshot())
  })

  return app
}
