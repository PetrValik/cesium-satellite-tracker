import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { AdsbFeed } from './adsb.ts'
import { AisFeed } from './ais.ts'
import { createApp } from './app.ts'
import { fetchCelestrakGroup } from './celestrak.ts'
import { Db } from './db.ts'
import { GROUPS } from './groups.ts'
import { Refresher } from './refresh.ts'
import { loadSeed } from './seed.ts'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'data')
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

const app = createApp({ db, refresher, ais, adsb })

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  const { satCount, groups } = db.counts()
  console.log(
    `[orbital-ops api] listening on http://localhost:${info.port} (${satCount} sats, ${groups} groups)`,
  )
})
