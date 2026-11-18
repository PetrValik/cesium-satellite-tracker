import { beforeEach, describe, expect, it } from 'vitest'
import { LIVE_EPSILON_MS, useSimClock } from '../sim/simClock'
import { useMode } from './modeStore'
import { useSatellites } from './satelliteStore'
import { transportVisibleFor, transportVisibleNow } from './transport'

const ISS = 25_544

describe('transportVisibleFor', () => {
  it('hides whenever the ORBITAL layer is off', () => {
    for (const satelliteSelected of [true, false])
      for (const simLive of [true, false])
        expect(transportVisibleFor({ satellitesVisible: false, satelliteSelected, simLive })).toBe(false)
  })
  it('shows with a satellite picked, at NOW or off it', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: true, simLive: true })).toBe(true)
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: true, simLive: false })).toBe(true)
  })
  it('hides on the boot screen: ORBITAL on, nothing picked, sim live', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: false, simLive: true })).toBe(false)
  })
  it('stays after a deselect while sim time is off NOW (the way back to NOW)', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: false, simLive: false })).toBe(true)
  })
})

describe('transportVisibleNow', () => {
  beforeEach(() => {
    useMode.setState({ satellitesVisible: true })
    useSatellites.setState({ selectedId: null })
    useSimClock.setState({ epochMs: Date.now(), rate: 1, playing: true })
  })
  it('reads the ORBITAL layer and the satellite selection', () => {
    expect(transportVisibleNow()).toBe(false)
    useSatellites.getState().select(ISS)
    expect(transportVisibleNow()).toBe(true)
    useMode.setState({ satellitesVisible: false })
    expect(transportVisibleNow()).toBe(false)
  })
  it('counts warped, paused and scrubbed-off-NOW sim time as not live', () => {
    const clock = useSimClock.getState()
    clock.setRate(60)
    expect(transportVisibleNow()).toBe(true)
    clock.resetToNow()
    expect(transportVisibleNow()).toBe(false)
    clock.togglePlay() // paused at ×1
    expect(transportVisibleNow()).toBe(true)
    clock.scrubTo(Date.now() - 2 * LIVE_EPSILON_MS)
    clock.play() // playing ×1 but 20 s behind wall time
    expect(transportVisibleNow()).toBe(true)
    useSimClock.setState({ epochMs: Date.now() - LIVE_EPSILON_MS / 2 })
    expect(transportVisibleNow()).toBe(false)
  })
})
