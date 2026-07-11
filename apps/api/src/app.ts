import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { LiveStatus } from '@orbital-ops/shared'
import type { AdsbFeed } from './aircraft/adsb.ts'
import { aircraftRoutes } from './aircraft/routes.ts'
import type { Db } from './satellites/db.ts'
import type { Refresher } from './satellites/refresh.ts'
import { satelliteRoutes } from './satellites/routes.ts'
import type { AisFeed } from './ships/ais.ts'
import { shipRoutes } from './ships/routes.ts'

export interface AppDeps {
  db: Db
  refresher: Refresher
  ais?: AisFeed
  adsb?: AdsbFeed
}

export function createApp({ db, refresher, ais, adsb }: AppDeps) {
  const app = new Hono()

  app.use('/api/*', cors())

  app.route('/', satelliteRoutes({ db, refresher }))
  app.route('/', shipRoutes({ ais }))
  app.route('/', aircraftRoutes({ adsb }))

  // Composes both live feeds, so it lives at the composition root.
  app.get('/api/live/status', (c) => {
    const status: LiveStatus = {
      ais: ais ? ais.status() : { configured: false, connected: false, ships: 0 },
      adsb: adsb ? adsb.status() : { configured: false, aircraft: 0, lastPollMs: null },
    }
    return c.json(status)
  })

  return app
}
