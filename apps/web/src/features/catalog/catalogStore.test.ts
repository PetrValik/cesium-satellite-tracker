import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupInfo, Satellite } from '@orbital-ops/shared'

const h = vi.hoisted(() => ({
  groups: vi.fn(),
  satellites: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: { groups: h.groups, satellites: h.satellites },
}))

const group = (slug: string, count = 1): GroupInfo => ({
  slug,
  name: slug.toUpperCase(),
  count,
  updatedAt: null,
  stale: false,
})

const sat = (noradId: number, name: string): Satellite => ({
  noradId,
  name,
  tle1: '1'.padEnd(69, 'x'),
  tle2: '2'.padEnd(69, 'x'),
  groups: [],
})

// The module owns a group cache and a singleton store — re-import it fresh
// per test so cache state cannot leak between tests.
type CatalogModule = typeof import('./catalogStore')
let useCatalog: CatalogModule['useCatalog']

beforeEach(async () => {
  h.groups.mockReset()
  h.satellites.mockReset()
  vi.resetModules()
  ;({ useCatalog } = await import('./catalogStore'))
})

/** groups: stations + science (with one shared satellite) + opt-in starlink. */
function wireHappyApi(): void {
  h.groups.mockResolvedValue([group('stations'), group('science'), group('starlink')])
  h.satellites.mockImplementation(async (slug: string) =>
    slug === 'stations' ? [sat(1, 'ISS'), sat(2, 'SHARED')] : [sat(2, 'SHARED'), sat(3, 'HST')],
  )
}

describe('catalogStore init', () => {
  it('loads every non-starlink group and merges satellites without duplicates', async () => {
    wireHappyApi()
    await useCatalog.getState().init()

    const s = useCatalog.getState()
    expect(s.groups.map((g) => g.slug)).toEqual(['stations', 'science', 'starlink'])
    expect(s.activeSlugs).toEqual(['stations', 'science'])
    expect(s.sats.map((x) => x.noradId)).toEqual([1, 2, 3]) // sat 2 appears once
    expect([...s.byId.keys()].sort()).toEqual([1, 2, 3])
    expect(s.booting).toBe(false)
    expect(s.offline).toBe(false)

    expect(h.satellites).toHaveBeenCalledTimes(2)
    expect(h.satellites).not.toHaveBeenCalledWith('starlink')
  })

  it('flags offline and finishes booting when the groups call fails', async () => {
    h.groups.mockRejectedValue(new Error('API unreachable'))
    await useCatalog.getState().init()

    const s = useCatalog.getState()
    expect(s.offline).toBe(true)
    expect(s.booting).toBe(false)
    expect(s.groups).toEqual([])
    expect(s.activeSlugs).toEqual([])
    expect(h.satellites).not.toHaveBeenCalled()
  })
})

describe('catalogStore toggleGroup', () => {
  it('serves a re-enabled group from cache instead of refetching', async () => {
    wireHappyApi()
    await useCatalog.getState().init()

    await useCatalog.getState().toggleGroup('stations') // off
    let s = useCatalog.getState()
    expect(s.activeSlugs).toEqual(['science'])
    expect(s.sats.map((x) => x.noradId)).toEqual([2, 3]) // shared sat 2 survives via science

    await useCatalog.getState().toggleGroup('stations') // back on — cache hit
    s = useCatalog.getState()
    expect(s.activeSlugs).toEqual(['science', 'stations'])
    expect(s.sats.map((x) => x.noradId).sort()).toEqual([1, 2, 3])
    expect(h.satellites).toHaveBeenCalledTimes(2) // still once per slug, both from init
  })
})

describe('catalogStore registerSat', () => {
  it('adds a search hit to byId without touching the working set', () => {
    useCatalog.getState().registerSat(sat(99, 'SEARCH HIT'))

    const s = useCatalog.getState()
    expect(s.byId.get(99)?.name).toBe('SEARCH HIT')
    expect(s.sats).toEqual([])
    expect(s.activeSlugs).toEqual([])
  })

  it('keeps the first registration when the same id arrives again', () => {
    useCatalog.getState().registerSat(sat(99, 'FIRST'))
    useCatalog.getState().registerSat(sat(99, 'SECOND'))

    const s = useCatalog.getState()
    expect(s.byId.get(99)?.name).toBe('FIRST')
    expect(s.byId.size).toBe(1)
  })
})
