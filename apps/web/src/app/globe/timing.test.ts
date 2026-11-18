import { describe, expect, it, vi } from 'vitest'

// constellationFeed reads the catalog store, which imports lib/api.
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { tickIntervalMs, tickLeadMs } from './constellationFeed'
import { LIVE_EPSILON_MS } from '../../core/sim/simClock'
import { frameAdvanceMs, needsWallResync } from './frameLoop'

describe('tickIntervalMs', () => {
  it('ticks once a second up to ×60, four times a second beyond, either direction', () => {
    expect(tickIntervalMs(1)).toBe(1000)
    expect(tickIntervalMs(60)).toBe(1000)
    expect(tickIntervalMs(-60)).toBe(1000)
    expect(tickIntervalMs(600)).toBe(250)
    expect(tickIntervalMs(3600)).toBe(250)
  })
})

describe('tickLeadMs', () => {
  it('requests one tick interval of sim time ahead while playing', () => {
    expect(tickLeadMs(1, true)).toBe(1000)
    expect(tickLeadMs(10, true)).toBe(10_000)
    expect(tickLeadMs(3600, true)).toBe(900_000)
    // Rewind leads backwards in time.
    expect(tickLeadMs(-60, true)).toBe(-60_000)
  })

  it('requests exactly the displayed time while paused', () => {
    expect(tickLeadMs(3600, false)).toBe(0)
  })
})

describe('frameAdvanceMs', () => {
  it('passes the full wall delta at ×1, however long the gap', () => {
    expect(frameAdvanceMs(16, 1)).toBe(16)
    expect(frameAdvanceMs(30_000, 1)).toBe(30_000)
  })

  it('clamps a tab-suspend gap to 500 ms while warping', () => {
    expect(frameAdvanceMs(16, 3600)).toBe(16)
    expect(frameAdvanceMs(30_000, 3600)).toBe(500)
    expect(frameAdvanceMs(30_000, -60)).toBe(500)
  })
})

describe('needsWallResync', () => {
  it('re-reads the wall clock after a background gap of 10 s or more', () => {
    expect(needsWallResync(LIVE_EPSILON_MS - 1)).toBe(false)
    expect(needsWallResync(LIVE_EPSILON_MS)).toBe(true)
    expect(needsWallResync(30_000)).toBe(true)
  })
})
