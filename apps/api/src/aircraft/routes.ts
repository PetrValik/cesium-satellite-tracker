import { Hono } from 'hono'
import type { AdsbFeed } from './adsb.ts'

export interface AircraftRoutesDeps {
  adsb?: AdsbFeed
}

export function aircraftRoutes({ adsb }: AircraftRoutesDeps): Hono {
  const app = new Hono()

  app.get('/api/aircraft', (c) => {
    if (!adsb) return c.json({ error: 'ADS-B feed unavailable' }, 503)
    c.header('Cache-Control', 'public, max-age=10')
    return c.json(adsb.snapshot())
  })

  return app
}
