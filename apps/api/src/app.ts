import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { GroupInfo, LiveStatus } from '@orbital-ops/shared'
import type { AdsbFeed } from './adsb.ts'
import type { AisFeed } from './ais.ts'
import type { Db } from './db.ts'
import { GROUP_BY_SLUG } from './groups.ts'
import type { Refresher } from './refresh.ts'

export interface AppDeps {
  db: Db
  refresher: Refresher
  ais?: AisFeed
  adsb?: AdsbFeed
}

export function createApp({ db, refresher, ais, adsb }: AppDeps) {
  const app = new Hono()

  app.use('/api/*', cors())

  app.get('/api/health', (c) => {
    const { satCount, groups } = db.counts()
    return c.json({ ok: true, satCount, groups })
  })

  app.get('/api/groups', (c) => {
    refresher.refreshExpiredInBackground()
    const groups: GroupInfo[] = db.listGroups().map((g) => ({
      slug: g.slug,
      name: g.name,
      count: g.count,
      updatedAt: g.updatedAt === null ? null : new Date(g.updatedAt).toISOString(),
      stale: refresher.isExpired(g.slug),
    }))
    return c.json(groups)
  })

  app.get('/api/satellites', async (c) => {
    const slug = c.req.query('group')
    if (!slug) return c.json({ error: 'missing ?group= parameter' }, 400)
    if (!GROUP_BY_SLUG.has(slug)) return c.json({ error: `unknown group: ${slug}` }, 404)
    try {
      await refresher.ensureFresh(slug)
    } catch {
      return c.json({ error: 'catalog unavailable: CelesTrak unreachable and no cached data' }, 503)
    }
    return c.json(db.getGroupSatellites(slug))
  })

  app.get('/api/satellites/search', (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length < 2) return c.json({ error: 'q must be at least 2 characters' }, 400)
    return c.json(db.search(q, 50))
  })

  app.get('/api/ships', (c) => {
    if (!ais || !ais.status().configured) {
      return c.json({ error: 'AIS feed not configured (set AISSTREAM_API_KEY)' }, 503)
    }
    return c.json(ais.snapshot())
  })

  app.get('/api/aircraft', (c) => {
    if (!adsb) return c.json({ error: 'ADS-B feed unavailable' }, 503)
    return c.json(adsb.snapshot())
  })

  app.get('/api/live/status', (c) => {
    const status: LiveStatus = {
      ais: ais ? ais.status() : { configured: false, connected: false, ships: 0 },
      adsb: adsb ? adsb.status() : { configured: false, aircraft: 0, lastPollMs: null },
    }
    return c.json(status)
  })

  app.get('/api/satellites/:noradId', (c) => {
    const idStr = c.req.param('noradId')
    if (!/^\d+$/.test(idStr)) return c.json({ error: 'invalid NORAD id' }, 400)
    const sat = db.getSatellite(Number(idStr))
    return sat ? c.json(sat) : c.json({ error: 'not found' }, 404)
  })

  return app
}
