import { beforeEach, describe, expect, it } from 'vitest'
import type { Satellite } from '@orbital-ops/shared'
import { useSatellites } from './satelliteStore'

const sat = (noradId: number, name: string): Satellite => ({
  noradId,
  name,
  tle1: '1'.padEnd(69, 'x'),
  tle2: '2'.padEnd(69, 'x'),
  groups: [],
})

beforeEach(() => {
  useSatellites.setState({ byId: new Map(), selectedId: null })
})

describe('satelliteStore registerSat', () => {
  it('adds a search hit to byId', () => {
    useSatellites.getState().registerSat(sat(99, 'SEARCH HIT'))
    expect(useSatellites.getState().byId.get(99)?.name).toBe('SEARCH HIT')
  })

  it('keeps the first registration when the same id arrives again', () => {
    useSatellites.getState().registerSat(sat(99, 'FIRST'))
    const before = useSatellites.getState()
    useSatellites.getState().registerSat(sat(99, 'SECOND'))

    const s = useSatellites.getState()
    expect(s.byId.get(99)?.name).toBe('FIRST')
    expect(s.byId.size).toBe(1)
    expect(s).toBe(before) // no-op: subscribers are not notified
  })

  it('makes a search hit resolvable before it is selected (register → select)', () => {
    const seen: (string | undefined)[] = []
    const unsub = useSatellites.subscribe((s, p) => {
      if (s.selectedId !== p.selectedId) seen.push(s.byId.get(s.selectedId ?? -1)?.name)
    })
    useSatellites.getState().registerSat(sat(99, 'SEARCH HIT'))
    useSatellites.getState().select(99)
    unsub()
    expect(seen).toEqual(['SEARCH HIT'])
  })
})

describe('satelliteStore upsertSats', () => {
  it('replaces an earlier record with the loaded one and keeps ids it does not carry', () => {
    useSatellites.getState().registerSat(sat(1, 'FROM SEARCH'))
    useSatellites.getState().registerSat(sat(99, 'OTHER HIT'))
    useSatellites.getState().upsertSats([sat(1, 'FROM GROUP'), sat(2, 'NEW')])

    const { byId } = useSatellites.getState()
    expect(byId.get(1)?.name).toBe('FROM GROUP')
    expect(byId.get(2)?.name).toBe('NEW')
    expect(byId.get(99)?.name).toBe('OTHER HIT')
    // Earlier ids keep their place; new ones append in working-set order.
    expect([...byId.keys()]).toEqual([1, 99, 2])
  })

  it('never touches the selection', () => {
    useSatellites.getState().select(25_544)
    useSatellites.getState().upsertSats([sat(1, 'ISS')])
    expect(useSatellites.getState().selectedId).toBe(25_544)
  })
})

describe('satelliteStore select', () => {
  it('sets and clears the selected id without touching byId', () => {
    useSatellites.getState().registerSat(sat(1, 'ISS'))
    const { byId } = useSatellites.getState()
    useSatellites.getState().select(1)
    expect(useSatellites.getState().selectedId).toBe(1)
    useSatellites.getState().select(null)
    expect(useSatellites.getState().selectedId).toBeNull()
    expect(useSatellites.getState().byId).toBe(byId)
  })
})
