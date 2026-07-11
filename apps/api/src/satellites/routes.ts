import { Hono } from 'hono'
import type { GroupInfo } from '@orbital-ops/shared'
import type { Db } from './db.ts'
import { GROUP_BY_SLUG } from './groups.ts'
import type { Refresher } from './refresh.ts'

export interface SatelliteRoutesDeps {
  db: Db
  refresher: Refresher
}

export function satelliteRoutes({ db, refresher }: SatelliteRoutesDeps): Hono {
  const app = new Hono()

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

  app.get('/api/satellites/:noradId', (c) => {
    const idStr = c.req.param('noradId')
    if (!/^\d+$/.test(idStr)) return c.json({ error: 'invalid NORAD id' }, 400)
    const sat = db.getSatellite(Number(idStr))
    return sat ? c.json(sat) : c.json({ error: 'not found' }, 404)
  })

  return app
}
