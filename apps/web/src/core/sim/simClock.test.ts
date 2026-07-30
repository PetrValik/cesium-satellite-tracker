import { beforeEach, describe, expect, it } from 'vitest'
import { isSimLive, LIVE_EPSILON_MS, useSimClock } from './simClock'

describe('simClock store', () => {
  beforeEach(() => {
    useSimClock.getState().resetToNow()
  })

  it('advances by wall dt × rate while playing', () => {
    const { scrubTo, setRate } = useSimClock.getState()
    scrubTo(1_000_000)
    useSimClock.setState({ playing: true })
    setRate(60)
    useSimClock.getState().advance(1000)
    expect(useSimClock.getState().epochMs).toBe(1_000_000 + 60_000)
  })

  it('runs backwards with a negative rate', () => {
    useSimClock.getState().scrubTo(1_000_000)
    useSimClock.setState({ playing: true })
    useSimClock.getState().setRate(-60)
    useSimClock.getState().advance(500)
    expect(useSimClock.getState().epochMs).toBe(1_000_000 - 30_000)
  })

  it('does not advance while paused', () => {
    useSimClock.getState().scrubTo(1_000_000)
    useSimClock.getState().advance(1000)
    expect(useSimClock.getState().epochMs).toBe(1_000_000)
  })

  it('scrubTo pauses playback at the target time', () => {
    useSimClock.getState().scrubTo(42)
    expect(useSimClock.getState().epochMs).toBe(42)
    expect(useSimClock.getState().playing).toBe(false)
  })

  it('resetToNow restores wall clock, rate 1, playing', () => {
    useSimClock.getState().scrubTo(42)
    useSimClock.getState().setRate(3600)
    const before = Date.now()
    useSimClock.getState().resetToNow()
    const s = useSimClock.getState()
    expect(s.epochMs).toBeGreaterThanOrEqual(before)
    expect(s.rate).toBe(1)
    expect(s.playing).toBe(true)
  })
})

describe('isSimLive', () => {
  const NOW = 1_000_000_000

  it('is live playing at 1x within the epsilon of wall time', () => {
    expect(isSimLive({ epochMs: NOW, rate: 1, playing: true }, NOW)).toBe(true)
    expect(isSimLive({ epochMs: NOW - LIVE_EPSILON_MS + 1, rate: 1, playing: true }, NOW)).toBe(true)
  })

  it('is not live under warp, even at wall time', () => {
    expect(isSimLive({ epochMs: NOW, rate: 60, playing: true }, NOW)).toBe(false)
    expect(isSimLive({ epochMs: NOW, rate: -60, playing: true }, NOW)).toBe(false)
  })

  it('is not live while paused', () => {
    expect(isSimLive({ epochMs: NOW, rate: 1, playing: false }, NOW)).toBe(false)
  })

  it('is not live once sim time drifts past the epsilon in either direction', () => {
    expect(isSimLive({ epochMs: NOW - LIVE_EPSILON_MS, rate: 1, playing: true }, NOW)).toBe(false)
    expect(isSimLive({ epochMs: NOW + LIVE_EPSILON_MS, rate: 1, playing: true }, NOW)).toBe(false)
  })

  it('matches the store after transport actions', () => {
    useSimClock.getState().resetToNow()
    expect(isSimLive(useSimClock.getState())).toBe(true)
    useSimClock.getState().setRate(60)
    expect(isSimLive(useSimClock.getState())).toBe(false)
    // Scrub away from now: paused AND out of epsilon.
    useSimClock.getState().scrubTo(Date.now() - 3_600_000)
    expect(isSimLive(useSimClock.getState())).toBe(false)
    useSimClock.getState().resetToNow()
    expect(isSimLive(useSimClock.getState())).toBe(true)
  })
})
