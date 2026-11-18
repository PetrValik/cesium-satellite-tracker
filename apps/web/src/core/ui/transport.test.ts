import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIVE_EPSILON_MS, SIM_RATES, useSimClock } from '../sim/simClock'
import { useWallClock } from '../sim/wallClock'
import { useMode } from './modeStore'
import { useSatellites } from './satelliteStore'
import { transportVisibility, transportVisibleFor, transportVisibleNow } from './transport'

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

describe('transportVisibility (what useTransportVisible reads)', () => {
  let unsubscribe = () => {}
  /** Every value the store notifies its subscribers (the hook's callers) with. */
  function recordNotifications(): boolean[] {
    const seen: boolean[] = []
    unsubscribe = transportVisibility.subscribe((visible) => seen.push(visible))
    return seen
  }
  beforeEach(() => {
    useMode.setState({ satellitesVisible: true })
    useSatellites.setState({ selectedId: null })
    useSimClock.getState().resetToNow()
    useWallClock.setState({ nowMs: Date.now() })
  })
  afterEach(() => unsubscribe())

  it('stays quiet through scrubs, rate steps and frames that keep the bar shown', () => {
    useSatellites.getState().select(ISS)
    const seen = recordNotifications()
    const clock = useSimClock.getState()
    for (let i = 1; i <= 50; i++) clock.scrubTo(Date.now() - i * 100) // inside the live window
    for (const rate of SIM_RATES) clock.setRate(rate)
    clock.play()
    for (let i = 0; i < 10; i++) clock.advance(16)
    expect(transportVisibility.get()).toBe(true)
    expect(seen).toEqual([])
  })

  it('flips exactly when transportVisibleNow() does', () => {
    // The wall store lags real time by up to one 10 s tick; liveness must not read it.
    useWallClock.setState({ nowMs: Date.now() - 2 * LIVE_EPSILON_MS })
    useSatellites.getState().select(ISS)
    const seen = recordNotifications()
    const clock = useSimClock.getState()
    const expectBoth = (visible: boolean) => {
      expect(transportVisibleNow()).toBe(visible)
      expect(transportVisibility.get()).toBe(visible)
    }
    useSatellites.getState().select(null) // deselect at NOW
    expectBoth(false)
    expect(seen).toEqual([false])
    clock.setRate(60)
    expectBoth(true)
    clock.resetToNow() // nothing selected: live at once, no wall tick needed
    expectBoth(false)
    expect(seen).toEqual([false, true, false])
  })

  it('follows a wall tick that finds the epoch left behind (background tab)', () => {
    const seen = recordNotifications()
    expect(transportVisibility.get()).toBe(false)
    // rAF starved: the epoch stalls while wall time runs on. An epoch move
    // alone is not an event (that would be a per-frame recompute).
    useSimClock.setState({ epochMs: Date.now() - 2 * LIVE_EPSILON_MS })
    expect(transportVisibility.get()).toBe(false)
    useWallClock.setState({ nowMs: Date.now() }) // the 10 s tick
    expect(transportVisibility.get()).toBe(true)
    // First frame back catches the epoch up; frameLoop's resync tick follows.
    useSimClock.getState().advance(2 * LIVE_EPSILON_MS)
    useWallClock.setState({ nowMs: Date.now() })
    expect(transportVisibility.get()).toBe(false)
    expect(seen).toEqual([true, false])
  })
})
