import { beforeEach, describe, expect, it, vi } from 'vitest'

// The domain stores import lib/api; nothing here fetches.
vi.mock('../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { useMode } from '../core/ui/modeStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import {
  deselectInMode,
  hasSelectionInMode,
  resolveTap,
  subscribeSelectionChanges,
} from './selectionMode'

beforeEach(() => {
  useMode.setState({ mode: 'orbital' })
  useCatalog.setState({ selectedId: null })
  useShips.setState({ selectedMmsi: null })
  useAircraft.setState({ selectedIcao: null })
})

describe('hasSelectionInMode', () => {
  it('reads only the given mode’s store', () => {
    useShips.setState({ selectedMmsi: 211_000_000 })
    expect(hasSelectionInMode('maritime')).toBe(true)
    expect(hasSelectionInMode('orbital')).toBe(false)
    expect(hasSelectionInMode('airspace')).toBe(false)
  })

  it('defaults to the focused mode', () => {
    useAircraft.setState({ selectedIcao: 'abc123' })
    expect(hasSelectionInMode()).toBe(false)
    useMode.setState({ mode: 'airspace' })
    expect(hasSelectionInMode()).toBe(true)
  })
})

describe('deselectInMode', () => {
  it('drops the focused mode’s selection and keeps the other domains’', () => {
    useCatalog.setState({ selectedId: 25_544 })
    useShips.setState({ selectedMmsi: 211_000_000 })
    useMode.setState({ mode: 'maritime' })
    deselectInMode()
    expect(useShips.getState().selectedMmsi).toBeNull()
    expect(useCatalog.getState().selectedId).toBe(25_544)
  })
})

describe('subscribeSelectionChanges', () => {
  it('reports every domain’s pick and deselect with its mode', () => {
    const seen: [string, boolean][] = []
    const off = subscribeSelectionChanges((mode, selected) => seen.push([mode, selected]))
    useCatalog.setState({ selectedId: 25_544 })
    useShips.setState({ selectedMmsi: 211_000_000 })
    useAircraft.setState({ selectedIcao: 'abc123' })
    useShips.setState({ selectedMmsi: null })
    expect(seen).toEqual([
      ['orbital', true],
      ['maritime', true],
      ['airspace', true],
      ['maritime', false],
    ])
    off()
  })

  it('ignores unrelated store updates and stops after unsubscribe', () => {
    const listener = vi.fn()
    const off = subscribeSelectionChanges(listener)
    useShips.setState({ selectedMmsi: null }) // unchanged
    useAircraft.setState({ available: true })
    expect(listener).not.toHaveBeenCalled()
    off()
    useCatalog.setState({ selectedId: 1 })
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('resolveTap', () => {
  // Pick-result stand-ins, by what they are on the globe.
  const satBillboard = { kind: 'constellation' }
  const orbitRing = { kind: 'orbit-ring' }
  const groundTrack = { kind: 'ground-track' }
  const footprint = { kind: 'footprint' }
  const port = { kind: 'port' }
  const launchSite = { kind: 'launch-site' }

  const claimSat = (hits: readonly unknown[]) => hits.includes(satBillboard)
  const thin = (hit: unknown) => hit === orbitRing || hit === groundTrack

  it('a tap with no hits is empty', () => {
    expect(resolveTap([], [claimSat], thin)).toBe('empty')
  })

  it('a claimed hit wins over a near-miss decoration under the same tap', () => {
    expect(resolveTap([orbitRing, satBillboard], [claimSat], thin)).toBe('claimed')
  })

  it('stops at the first claimer', () => {
    const second = vi.fn(() => true)
    expect(resolveTap([satBillboard], [claimSat, second], thin)).toBe('claimed')
    expect(second).not.toHaveBeenCalled()
  })

  it('the orbit ring and ground track are a near-miss', () => {
    expect(resolveTap([orbitRing], [claimSat], thin)).toBe('near-miss')
    expect(resolveTap([footprint, groundTrack], [claimSat], thin)).toBe('near-miss')
  })

  it('footprint fill, ports and launch sites alone are an empty tap', () => {
    expect(resolveTap([footprint], [claimSat], thin)).toBe('empty')
    expect(resolveTap([port], [claimSat], thin)).toBe('empty')
    expect(resolveTap([launchSite, footprint], [claimSat], thin)).toBe('empty')
  })
})
