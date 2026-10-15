import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import type { Ship } from '@orbital-ops/shared'

// The domain stores import lib/api; nothing here fetches.
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { useFollow } from '../../core/ui/followStore'
import { useMode } from '../../core/ui/modeStore'
import { useAircraft } from '../../features/airspace/aircraftStore'
import { useCatalog } from '../../features/catalog/catalogStore'
import { useShips } from '../../features/maritime/shipsStore'
import { GlobeFollow, orbitalFollowRangeM, releasesFollow } from './follow'
import { LayerSync, type SyncedLayers } from './layerSync'

const SHIP: Ship = {
  mmsi: 211_000_000,
  name: 'TEST VESSEL',
  latDeg: 54,
  lonDeg: 10,
  sogKn: 0,
  cogDeg: 0,
  hdgDeg: null,
  shipType: 'cargo',
  tsMs: Date.now(),
}

describe('releasesFollow', () => {
  it('releases only when the cleared domain is the followed one', () => {
    expect(releasesFollow('maritime', 'maritime')).toBe(true)
    expect(releasesFollow('maritime', 'airspace')).toBe(false)
    expect(releasesFollow('orbital', 'maritime')).toBe(false)
    expect(releasesFollow(null, 'orbital')).toBe(false)
  })
})

describe('orbitalFollowRangeM', () => {
  it('is three altitudes, clamped to [150 km, 80 000 km]', () => {
    expect(orbitalFollowRangeM(400)).toBe(1_200_000)
    expect(orbitalFollowRangeM(10)).toBe(150_000)
    expect(orbitalFollowRangeM(35_786)).toBe(80_000_000)
  })
})

function fakes() {
  const rig = { follow: vi.fn(), unfollow: vi.fn() }
  const decal = () => ({ setPose: vi.fn(), hide: vi.fn() })
  const shipDecal = decal()
  const aircraftDecal = decal()
  const satellite = { active: false }
  const follow = new GlobeFollow(rig, satellite, shipDecal, aircraftDecal)
  return { rig, shipDecal, aircraftDecal, satellite, follow }
}

function fakeLayers(): SyncedLayers {
  const layer = () => ({
    setShips: vi.fn(),
    setAircraft: vi.fn(),
    setSelected: vi.fn(),
    setVisible: vi.fn(),
    setPalette: vi.fn(),
  })
  return {
    viewer: {} as Viewer,
    constellation: layer(),
    satellite: { select: vi.fn(() => null), active: false },
    ships: layer(),
    aircraft: layer(),
    launchSites: layer(),
    ports: layer(),
  }
}

const disposers: (() => void)[] = []

beforeEach(() => {
  useFollow.setState({ following: false })
  useMode.setState({
    mode: 'maritime',
    satellitesVisible: true,
    shipsVisible: true,
    aircraftVisible: false,
  })
  useCatalog.setState({ selectedId: null })
  useShips.setState({ ships: [SHIP], byMmsi: new Map([[SHIP.mmsi, SHIP]]), selectedMmsi: null })
  useAircraft.setState({ selectedIcao: null })
})

afterEach(() => {
  while (disposers.length > 0) disposers.pop()!()
})

describe('GlobeFollow', () => {
  it('a picked ship engages the lock; clearing it releases', () => {
    const { rig, shipDecal, follow } = fakes()
    disposers.push(() => follow.dispose())
    useShips.setState({ selectedMmsi: SHIP.mmsi })
    follow.liveSelected()
    expect(useFollow.getState().following).toBe(true)
    expect(rig.follow).toHaveBeenCalledTimes(1)
    expect(rig.follow.mock.calls[0][1]).toBe(60_000)

    follow.cleared('maritime')
    expect(shipDecal.hide).toHaveBeenCalled()
    expect(useFollow.getState().following).toBe(false)
    expect(rig.unfollow).toHaveBeenCalledTimes(1)
  })

  it('an existing lock is re-pointed, not re-engaged through the store', () => {
    const { rig, follow } = fakes()
    disposers.push(() => follow.dispose())
    useShips.setState({ selectedMmsi: SHIP.mmsi })
    follow.liveSelected()
    follow.liveSelected()
    expect(rig.follow).toHaveBeenCalledTimes(2)
    expect(rig.unfollow).not.toHaveBeenCalled()
  })

  it('clearing a domain the lock does not ride keeps it, whatever the focused mode', () => {
    const { follow } = fakes()
    disposers.push(() => follow.dispose())
    useShips.setState({ selectedMmsi: SHIP.mmsi })
    follow.liveSelected()
    useMode.setState({ mode: 'airspace' })
    follow.cleared('airspace')
    expect(useFollow.getState().following).toBe(true)
    // The FOLLOWED domain releases even with focus elsewhere (commit 3f34845).
    follow.cleared('maritime')
    expect(useFollow.getState().following).toBe(false)
  })

  it('engaging with nothing selected in the focused mode drops the intent', () => {
    const { rig, follow } = fakes()
    disposers.push(() => follow.dispose())
    useMode.setState({ mode: 'orbital' })
    useFollow.getState().setFollowing(true)
    expect(useFollow.getState().following).toBe(false)
    expect(rig.follow).not.toHaveBeenCalled()
  })

  it('dispose releases the lock before unsubscribing', () => {
    const { rig, follow } = fakes()
    useShips.setState({ selectedMmsi: SHIP.mmsi })
    follow.liveSelected()
    follow.dispose()
    expect(useFollow.getState().following).toBe(false)
    expect(rig.unfollow).toHaveBeenCalledTimes(1)
    useFollow.getState().setFollowing(true)
    expect(rig.follow).toHaveBeenCalledTimes(1)
  })
})

describe('LayerSync + GlobeFollow', () => {
  function mount() {
    const f = fakes()
    const layers = fakeLayers()
    const sync = new LayerSync(layers, f.follow)
    disposers.push(() => f.follow.dispose(), () => sync.dispose())
    return { ...f, layers }
  }

  it('selecting a ship in the store locks the camera onto it', () => {
    const { rig, layers } = mount()
    useShips.getState().select(SHIP.mmsi)
    expect(layers.ships.setSelected).toHaveBeenLastCalledWith(SHIP.mmsi)
    expect(useFollow.getState().following).toBe(true)
    expect(rig.follow).toHaveBeenCalledTimes(1)
  })

  it('hiding the followed domain from LAYERS releases the lock although focus moved first', () => {
    const { rig } = mount()
    useShips.getState().select(SHIP.mmsi)
    expect(useFollow.getState().following).toBe(true)
    // One store update hides maritime AND refocuses `mode` (orbital is the
    // first visible domain); the selection clear follows from it.
    useMode.getState().toggleLayer('maritime')
    expect(useMode.getState().mode).toBe('orbital')
    expect(useShips.getState().selectedMmsi).toBeNull()
    expect(useFollow.getState().following).toBe(false)
    expect(rig.unfollow).toHaveBeenCalledTimes(1)
  })

  it('hiding another domain leaves the lock alone', () => {
    const { rig } = mount()
    useShips.getState().select(SHIP.mmsi)
    useMode.getState().toggleLayer('orbital')
    expect(useFollow.getState().following).toBe(true)
    expect(rig.unfollow).not.toHaveBeenCalled()
  })
})
