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
// per test so cache state cannot leak between tests. The entity store it
// publishes into is re-imported with it (same fresh module graph).
type CatalogModule = typeof import('./catalogStore')
type SatelliteModule = typeof import('../../core/ui/satelliteStore')
let useCatalog: CatalogModule['useCatalog']
let useSatellites: SatelliteModule['useSatellites']

beforeEach(async () => {
  h.groups.mockReset()
  h.satellites.mockReset()
  vi.resetModules()
  ;({ useCatalog } = await import('./catalogStore'))
  ;({ useSatellites } = await import('../../core/ui/satelliteStore'))
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
    expect([...useSatellites.getState().byId.keys()].sort()).toEqual([1, 2, 3])
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

describe('catalogStore init partial failures', () => {
  it('flags offline when /groups answers but every group fetch fails', async () => {
    h.groups.mockResolvedValue([group('stations'), group('science'), group('starlink')])
    h.satellites.mockRejectedValue(new Error('API unreachable'))
    await useCatalog.getState().init()

    const s = useCatalog.getState()
    expect(s.offline).toBe(true)
    expect(s.booting).toBe(false)
    expect(s.groups).toHaveLength(3) // the group list itself did load
    expect(s.activeSlugs).toEqual([])
  })

  it('stays online when only some groups fail, keeping the ones that loaded', async () => {
    h.groups.mockResolvedValue([group('stations'), group('science')])
    h.satellites.mockImplementation(async (slug: string) => {
      if (slug === 'science') throw new Error('502')
      return [sat(1, 'ISS')]
    })
    await useCatalog.getState().init()

    const s = useCatalog.getState()
    expect(s.offline).toBe(false)
    expect(s.activeSlugs).toEqual(['stations'])
    expect(s.sats.map((x) => x.noradId)).toEqual([1])
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

  it('keeps a selected satellite resolvable and selected when its group goes off', async () => {
    wireHappyApi()
    await useCatalog.getState().init()
    useSatellites.getState().select(1) // ISS: only in stations

    await useCatalog.getState().toggleGroup('stations') // off
    expect(useCatalog.getState().sats.map((x) => x.noradId)).toEqual([2, 3])
    const { byId, selectedId } = useSatellites.getState()
    expect(selectedId).toBe(1)
    expect(byId.get(1)?.name).toBe('ISS') // byId never shrinks
  })
})

describe('catalogStore → satellite entity store', () => {
  it('publishes byId before sats, so every working-set id resolves when sats changes', async () => {
    wireHappyApi()
    const unresolved: number[] = []
    let sawSats = 0
    const unsub = useCatalog.subscribe((state, prev) => {
      if (state.sats === prev.sats) return
      sawSats++
      const { byId } = useSatellites.getState()
      for (const x of state.sats) if (!byId.has(x.noradId)) unresolved.push(x.noradId)
    })

    await useCatalog.getState().init()
    await useCatalog.getState().toggleGroup('stations') // off
    await useCatalog.getState().toggleGroup('starlink') // on — fetched
    unsub()

    expect(sawSats).toBe(3)
    expect(unresolved).toEqual([])
  })

  it('keeps a search hit in byId across loads without adding it to the working set', async () => {
    wireHappyApi()
    useSatellites.getState().registerSat(sat(99, 'SEARCH HIT'))

    await useCatalog.getState().init()

    expect(useSatellites.getState().byId.get(99)?.name).toBe('SEARCH HIT')
    expect(useCatalog.getState().sats.map((x) => x.noradId)).toEqual([1, 2, 3])
  })

  it('replaces a record with the first active group that carries it on a toggle', async () => {
    wireHappyApi()
    await useCatalog.getState().init()
    const fromStations = useSatellites.getState().byId.get(2)

    await useCatalog.getState().toggleGroup('stations') // off: science now supplies sat 2
    const fromScience = useSatellites.getState().byId.get(2)
    expect(fromScience?.name).toBe('SHARED')
    expect(fromScience).not.toBe(fromStations)
    expect(useCatalog.getState().sats.find((x) => x.noradId === 2)).toBe(fromScience)
  })
})
