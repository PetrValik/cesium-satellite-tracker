import { beforeEach, describe, expect, it, vi } from 'vitest'

// The domain stores import lib/api; nothing here fetches.
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { useMode } from '../../core/ui/modeStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import { useAircraft } from '../../features/airspace/aircraftStore'
import { useShips } from '../../features/maritime/shipsStore'
import { claimOrder, createTapRouter } from './tapRouting'

// Stand-in pick results: each layer recognises only its own tagged objects.
const SAT = { sat: 25_544 }
const SHIP = { ship: 211_000_000 }
const PLANE = { plane: 'abc123' }
const SHIP_DECAL = { decal: 'ship' }
const MARKER = { marker: true }
const RING = { ring: true }
const FOOTPRINT = { footprint: true }

/** The id a stand-in hit carries under `key`, or null. */
const idIn = (key: string, hit: unknown) =>
  typeof hit === 'object' && hit !== null && key in hit
    ? (hit as Record<string, unknown>)[key]
    : null

function router() {
  return createTapRouter({
    constellation: { idOf: (hit) => idIn('sat', hit) as number | null },
    tracking: { ownsMarker: (hit) => hit === MARKER, ownsThinDecoration: (hit) => hit === RING },
    ships: { idOf: (hit) => idIn('ship', hit) as number | null },
    shipDecal: { owns: (hit) => hit === SHIP_DECAL },
    aircraft: { idOf: (hit) => idIn('plane', hit) as string | null },
    aircraftDecal: { owns: () => false },
  })
}

beforeEach(() => {
  useMode.setState({
    mode: 'orbital',
    satellitesVisible: true,
    shipsVisible: true,
    aircraftVisible: true,
  })
  useSatellites.setState({ selectedId: null })
  useShips.setState({ selectedMmsi: null })
  useAircraft.setState({ selectedIcao: null })
})

describe('claimOrder', () => {
  it('puts the focused mode first, then maritime before airspace before orbital', () => {
    expect(claimOrder('orbital')).toEqual(['orbital', 'maritime', 'airspace'])
    expect(claimOrder('maritime')).toEqual(['maritime', 'airspace', 'orbital'])
    expect(claimOrder('airspace')).toEqual(['airspace', 'maritime', 'orbital'])
  })
})

describe('createTapRouter', () => {
  it('the focused layer wins over a nearer hit of another domain', () => {
    useMode.setState({ mode: 'maritime' })
    router()([SAT, SHIP])
    expect(useShips.getState().selectedMmsi).toBe(211_000_000)
    expect(useSatellites.getState().selectedId).toBeNull()
  })

  it('a cross-domain claim selects there and switches mode', () => {
    router()([PLANE])
    expect(useAircraft.getState().selectedIcao).toBe('abc123')
    expect(useMode.getState().mode).toBe('airspace')
  })

  it('a tap on the selected object’s own marker keeps it selected', () => {
    useSatellites.setState({ selectedId: 25_544 })
    router()([MARKER, { sat: 99 }])
    expect(useSatellites.getState().selectedId).toBe(25_544)
    useMode.setState({ mode: 'maritime' })
    useShips.setState({ selectedMmsi: 211_000_000 })
    router()([SHIP_DECAL, { ship: 1 }])
    expect(useShips.getState().selectedMmsi).toBe(211_000_000)
  })

  it('an orbit-ring near-miss keeps the ORBITAL selection; footprint or nothing deselects', () => {
    useSatellites.setState({ selectedId: 25_544 })
    router()([RING])
    expect(useSatellites.getState().selectedId).toBe(25_544)
    router()([FOOTPRINT])
    expect(useSatellites.getState().selectedId).toBeNull()
    useSatellites.setState({ selectedId: 25_544 })
    router()([])
    expect(useSatellites.getState().selectedId).toBeNull()
  })

  it('an empty tap deselects only in the focused mode, where the ring is no near-miss', () => {
    useSatellites.setState({ selectedId: 25_544 })
    useShips.setState({ selectedMmsi: 211_000_000 })
    useMode.setState({ mode: 'maritime' })
    router()([RING])
    expect(useShips.getState().selectedMmsi).toBeNull()
    expect(useSatellites.getState().selectedId).toBe(25_544)
  })
})
