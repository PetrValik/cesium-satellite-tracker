import { beforeEach, describe, expect, it } from 'vitest'
import { useSimClock } from './simClock'

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
