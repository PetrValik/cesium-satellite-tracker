import { describe, expect, it, vi } from 'vitest'
import {
  GroupListSchema,
  HealthSchema,
  SatelliteListSchema,
  SatelliteSchema,
} from '@orbital-ops/shared'
import { DEFAULT_FAILURE_COOLDOWN_MS, DEFAULT_TTL_MS } from '../src/refresh.ts'
import { failingFetcher, testEnv, tleFor } from './helpers.ts'

describe('GET /api/satellites?group=', () => {
  it('fetches from CelesTrak on first request and serves from cache within TTL', async () => {
    const fetcher = vi.fn(async () => tleFor(25544, 'ISS (ZARYA)'))
    const { app, advance } = testEnv(fetcher)

    const res = await app.request('/api/satellites?group=stations')
    expect(res.status).toBe(200)
    const sats = SatelliteListSchema.parse(await res.json())
    expect(sats).toHaveLength(1)
    expect(sats[0]).toMatchObject({ noradId: 25544, name: 'ISS (ZARYA)', groups: ['stations'] })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('stations')

    advance(DEFAULT_TTL_MS - 1)
    await app.request('/api/satellites?group=stations')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('serves stale data immediately and revalidates in the background', async () => {
    let release!: (text: string) => void
    const fetcher = vi.fn((): Promise<string> => {
      if (fetcher.mock.calls.length === 1) return Promise.resolve(tleFor(25544, 'ISS (ZARYA)'))
      return new Promise((resolve) => {
        release = resolve
      })
    })
    const { app, db, advance } = testEnv(fetcher)

    await app.request('/api/satellites?group=stations')
    advance(DEFAULT_TTL_MS + 1)

    const res = await app.request('/api/satellites?group=stations')
    const sats = SatelliteListSchema.parse(await res.json())
    expect(sats[0]!.name).toBe('ISS (ZARYA)') // refresh still in flight
    expect(fetcher).toHaveBeenCalledTimes(2)

    release(tleFor(25544, 'ISS (RENAMED)'))
    await vi.waitFor(() => {
      expect(db.getSatellite(25544)?.name).toBe('ISS (RENAMED)')
    })
  })

  it('keeps serving stale data when CelesTrak is down', async () => {
    let down = false
    const fetcher = vi.fn(async () => {
      if (down) throw new Error('boom')
      return tleFor(25544, 'ISS (ZARYA)')
    })
    const { app, advance } = testEnv(fetcher)

    await app.request('/api/satellites?group=stations')
    advance(DEFAULT_TTL_MS + 1)
    down = true

    const res = await app.request('/api/satellites?group=stations')
    expect(res.status).toBe(200)
    expect(SatelliteListSchema.parse(await res.json())).toHaveLength(1)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))

    const groups = GroupListSchema.parse(await (await app.request('/api/groups')).json())
    const stations = groups.find((g) => g.slug === 'stations')!
    expect(stations).toMatchObject({ count: 1, stale: true })
  })

  it('returns 503 when the cache is empty and CelesTrak is down', async () => {
    const { app } = testEnv(failingFetcher())
    const res = await app.request('/api/satellites?group=stations')
    expect(res.status).toBe(503)
  })

  it('cools down after a failed refresh instead of hammering CelesTrak', async () => {
    const fetcher = failingFetcher()
    const { app, advance } = testEnv(fetcher)

    expect((await app.request('/api/satellites?group=stations')).status).toBe(503)
    expect((await app.request('/api/satellites?group=stations')).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(1) // stations retry suppressed by cooldown

    await app.request('/api/groups') // sweep: the 11 other groups each fetch once
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(12))
    await app.request('/api/groups') // all groups cooling down now — no new fetches
    expect(fetcher).toHaveBeenCalledTimes(12)

    advance(DEFAULT_FAILURE_COOLDOWN_MS + 1)
    expect((await app.request('/api/satellites?group=stations')).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(13)
  })

  it('rejects unknown groups with 404 and a missing param with 400', async () => {
    const { app } = testEnv(failingFetcher())
    expect((await app.request('/api/satellites?group=nonsense')).status).toBe(404)
    expect((await app.request('/api/satellites')).status).toBe(400)
  })

  it('deduplicates concurrent refreshes of the same group', async () => {
    const fetcher = vi.fn(async () => tleFor(25544, 'ISS (ZARYA)'))
    const { app } = testEnv(fetcher)
    await Promise.all([
      app.request('/api/satellites?group=stations'),
      app.request('/api/satellites?group=stations'),
      app.request('/api/satellites?group=stations'),
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('membership across groups', () => {
  it('reports every group a satellite belongs to', async () => {
    const fetcher = vi.fn(async (group: string) =>
      group === 'stations'
        ? tleFor(25544, 'ISS (ZARYA)')
        : tleFor(25544, 'ISS (ZARYA)') + tleFor(20580, 'HST'),
    )
    const { app } = testEnv(fetcher)
    await app.request('/api/satellites?group=stations')
    await app.request('/api/satellites?group=science')

    const res = await app.request('/api/satellites/25544')
    const sat = SatelliteSchema.parse(await res.json())
    expect(sat.groups).toEqual(['science', 'stations'])
  })
})

describe('GET /api/satellites/search', () => {
  async function searchEnv() {
    const fetcher = vi.fn(async () => tleFor(25544, 'ISS (ZARYA)') + tleFor(20580, 'HST'))
    const env = testEnv(fetcher)
    await env.app.request('/api/satellites?group=stations')
    return env
  }

  it('matches names case-insensitively', async () => {
    const { app } = await searchEnv()
    const res = await app.request('/api/satellites/search?q=iss')
    const sats = SatelliteListSchema.parse(await res.json())
    expect(sats.map((s) => s.noradId)).toEqual([25544])
  })

  it('matches NORAD id prefixes', async () => {
    const { app } = await searchEnv()
    const sats = SatelliteListSchema.parse(
      await (await app.request('/api/satellites/search?q=2058')).json(),
    )
    expect(sats.map((s) => s.noradId)).toEqual([20580])
  })

  it('rejects queries shorter than 2 characters', async () => {
    const { app } = await searchEnv()
    expect((await app.request('/api/satellites/search?q=x')).status).toBe(400)
    expect((await app.request('/api/satellites/search')).status).toBe(400)
  })

  it('treats LIKE wildcards as literals', async () => {
    const { app } = await searchEnv()
    const sats = SatelliteListSchema.parse(
      await (await app.request('/api/satellites/search?q=%25%25')).json(),
    )
    expect(sats).toHaveLength(0)
  })
})

describe('GET /api/satellites/:noradId', () => {
  it('returns the satellite or a 404/400', async () => {
    const fetcher = vi.fn(async () => tleFor(25544, 'ISS (ZARYA)'))
    const { app } = testEnv(fetcher)
    await app.request('/api/satellites?group=stations')

    const sat = SatelliteSchema.parse(await (await app.request('/api/satellites/25544')).json())
    expect(sat.name).toBe('ISS (ZARYA)')
    expect((await app.request('/api/satellites/99999')).status).toBe(404)
    expect((await app.request('/api/satellites/abc')).status).toBe(400)
  })
})

describe('GET /api/health and /api/groups', () => {
  it('reports counts and per-group freshness', async () => {
    const fetcher = vi.fn(async () => tleFor(25544, 'ISS (ZARYA)') + tleFor(20580, 'HST'))
    const { app } = testEnv(fetcher)
    await app.request('/api/satellites?group=stations')

    const health = HealthSchema.parse(await (await app.request('/api/health')).json())
    expect(health).toMatchObject({ ok: true, satCount: 2, groups: 12 })

    const groups = GroupListSchema.parse(await (await app.request('/api/groups')).json())
    const stations = groups.find((g) => g.slug === 'stations')!
    expect(stations.count).toBe(2)
    expect(stations.stale).toBe(false)
    expect(stations.updatedAt).not.toBeNull()
    expect(groups.filter((g) => g.slug !== 'stations').every((g) => g.stale)).toBe(true)
  })
})
