import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
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
const app = createApp({ db, refresher })

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port }, (info) => {
  const { satCount, groups } = db.counts()
  console.log(
    `[orbital-ops api] listening on http://localhost:${info.port} (${satCount} sats, ${groups} groups)`,
  )
})
