/**
 * App factory — the API's composition root. Wires middleware (secure
 * headers, optional rate limit, allowlist-only CORS) and mounts the slice
 * routers; everything is injected so tests run against fakes. Route
 * mounting order matters only within a slice; middleware here must be
 * registered before the mounts to cover them.
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serveStatic } from '@hono/node-server/serve-static'
import { relative } from 'node:path'
import type { LiveStatus } from '@orbital-ops/shared'
import type { AdsbFeed } from './aircraft/adsb.ts'
import { aircraftRoutes } from './aircraft/routes.ts'
import type { Db } from './satellites/db.ts'
import type { Refresher } from './satellites/refresh.ts'
import { satelliteRoutes } from './satellites/routes.ts'
import { rateLimit, type RateLimitOptions } from './shared/rateLimit.ts'
import type { AisFeed } from './ships/ais.ts'
import { shipRoutes } from './ships/routes.ts'

export interface AppDeps {
  db: Db
  refresher: Refresher
  ais?: AisFeed
  adsb?: AdsbFeed
  /**
   * CORS allowlist. Omitted/empty = no CORS headers at all: the API is
   * same-origin with the web app (dev proxy / production static serving),
   * so cross-origin reads stay blocked by default.
   */
  allowedOrigins?: string[]
  /** Per-IP limiter config; omitted = no rate limiting (tests, dev). */
  rateLimit?: RateLimitOptions
  /** Absolute path of the built web app; omitted = API only. */
  webDist?: string
}

export function createApp(deps: AppDeps) {
  const { db, refresher, ais, adsb } = deps
  const app = new Hono()

  app.use(secureHeaders())
  if (deps.rateLimit) app.use('/api/*', rateLimit(deps.rateLimit))
  if (deps.allowedOrigins !== undefined && deps.allowedOrigins.length > 0) {
    app.use('/api/*', cors({ origin: deps.allowedOrigins }))
  }

  app.route('/', satelliteRoutes({ db, refresher }))
  app.route('/', shipRoutes({ ais }))
  app.route('/', aircraftRoutes({ adsb }))

  // Composes both live feeds, so it lives at the composition root.
  app.get('/api/live/status', (c) => {
    const status: LiveStatus = {
      ais: ais ? ais.status() : { configured: false, connected: false, ships: 0 },
      adsb: adsb ? adsb.status() : { configured: false, aircraft: 0, lastPollMs: null },
    }
    c.header('Cache-Control', 'no-store')
    return c.json(status)
  })

  if (deps.webDist !== undefined) {
    // serveStatic resolves against CWD; SPA fallback for client-side routes.
    const root = relative(process.cwd(), deps.webDist) || '.'
    app.use('*', serveStatic({ root }))
    app.get('*', serveStatic({ path: `${root}/index.html` }))
  }

  return app
}
