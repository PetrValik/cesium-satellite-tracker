import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { AdsbFeed } from './aircraft/adsb.ts'
import { createApp } from './app.ts'
import { fetchCelestrakGroup } from './satellites/celestrak.ts'
import { Db } from './satellites/db.ts'
import { GROUPS } from './satellites/groups.ts'
import { Refresher } from './satellites/refresh.ts'
import { loadSeed } from './satellites/seed.ts'
import { AisFeed } from './ships/ais.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.DATA_DIR ?? join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new Db(join(dataDir, 'tle-cache.db'))
db.ensureGroups(GROUPS)

if (db.counts().satCount === 0) {
  const seeded = loadSeed(db, join(here, '..', 'seed'))
  console.log(`[orbital-ops api] seeded ${seeded} TLE records from committed snapshot`)
}

const refresher = new Refresher({ db, fetcher: fetchCelestrakGroup })

const ais = new AisFeed({ apiKey: process.env.AISSTREAM_API_KEY })
ais.start()
console.log(
  ais.status().configured
    ? '[orbital-ops api] AIS feed: configured, streaming from aisstream.io'
    : '[orbital-ops api] AIS feed: not configured (set AISSTREAM_API_KEY) — /api/ships returns 503',
)

const adsb = new AdsbFeed({
  clientId: process.env.OPENSKY_CLIENT_ID,
  clientSecret: process.env.OPENSKY_CLIENT_SECRET,
})
adsb.start()
console.log(
  adsb.authenticated
    ? '[orbital-ops api] ADS-B feed: authenticated OpenSky polling every 60s'
    : '[orbital-ops api] ADS-B feed: anonymous OpenSky polling every 600s (set OPENSKY_CLIENT_ID/OPENSKY_CLIENT_SECRET for 60s)',
)

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0)

const webDist = process.env.WEB_DIST
if (webDist) console.log(`[orbital-ops api] serving web app from ${webDist}`)

const app = createApp({
  db,
  refresher,
  ais,
  adsb,
  allowedOrigins,
  rateLimit: { trustProxy: process.env.TRUST_PROXY === '1' },
  webDist,
})

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  const { satCount, groups } = db.counts()
  console.log(
    `[orbital-ops api] listening on http://localhost:${info.port} (${satCount} sats, ${groups} groups)`,
  )
})
