import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aircraft } from '@orbital-ops/shared'

const h = vi.hoisted(() => {
  /** Mirror of lib/api's ApiError; stable identity across module resets. */
  class MockApiError extends Error {
    readonly status: number | null
    constructor(message: string, status: number | null) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  }
  return { ApiError: MockApiError, aircraft: vi.fn() }
})

vi.mock('../../lib/api', () => ({ ApiError: h.ApiError, api: { aircraft: h.aircraft } }))

const POLL_MS = 30_000
const UNCONFIGURED_RECHECK_TICKS = 10
const NOW = 1_750_000_000_000

const plane = (icao24: string): Aircraft => ({
  icao24,
  callsign: `TST${icao24.slice(-2)}`,
  latDeg: 47.4,
  lonDeg: 8.5,
  altM: 11_582.4,
  velocityMs: 245.6,
  trackDeg: 87.3,
  verticalRateMs: 0.3,
  onGround: false,
  tsMs: NOW,
})

// The module owns the interval timer and the backoff counter — re-import it
// fresh per test so that state cannot leak between tests.
type AircraftModule = typeof import('./aircraftStore')
let mod: AircraftModule

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  h.aircraft.mockReset()
  vi.resetModules()
  mod = await import('./aircraftStore')
})

afterEach(() => {
  mod.stopAircraftPolling()
  vi.useRealTimers()
})

describe('aircraftStore polling', () => {
  it('populates aircraft, byIcao, and lastPollMs on a successful poll', async () => {
    h.aircraft.mockResolvedValue([plane('4b1814'), plane('4b1815')])

    mod.startAircraftPolling()
    await vi.advanceTimersByTimeAsync(0)

    const s = mod.useAircraft.getState()
    expect(s.aircraft).toHaveLength(2)
    expect(s.byIcao.get('4b1815')?.callsign).toBe('TST15')
    expect(s.available).toBe(true)
    expect(s.lastPollMs).toBe(NOW)
  })

  it('backs off after a 503 (feed unconfigured) instead of polling every tick', async () => {
    h.aircraft.mockRejectedValue(new h.ApiError('ADS-B feed not configured', 503))

    mod.startAircraftPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(mod.useAircraft.getState().available).toBe(false)
    expect(h.aircraft).toHaveBeenCalledTimes(1)

    // every tick inside the recheck window is suppressed
    await vi.advanceTimersByTimeAsync(UNCONFIGURED_RECHECK_TICKS * POLL_MS)
    expect(h.aircraft).toHaveBeenCalledTimes(1)

    // the first tick after the counter elapses re-checks the feed
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.aircraft).toHaveBeenCalledTimes(2)
  })

  it('keeps retrying every tick on a network error (no backoff)', async () => {
    h.aircraft.mockRejectedValue(new h.ApiError('API unreachable', null))

    mod.startAircraftPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(mod.useAircraft.getState().available).toBe(false)
    expect(h.aircraft).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.aircraft).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.aircraft).toHaveBeenCalledTimes(3)
  })
})

describe('aircraftStore poll failures', () => {
  it('logs a contract break (non-ApiError) and keeps the last snapshot', async () => {
    const drift = new Error('zod: expected number, received string')
    h.aircraft.mockResolvedValueOnce([plane('4b1814')])
    h.aircraft.mockRejectedValueOnce(drift)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    mod.startAircraftPolling()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(log).toHaveBeenCalledWith(expect.any(String), drift)
    expect(mod.useAircraft.getState().available).toBe(false)
    expect(mod.useAircraft.getState().aircraft).toHaveLength(1)
    log.mockRestore()
  })

  it('stopAircraftPolling clears the interval', async () => {
    h.aircraft.mockResolvedValue([])
    mod.startAircraftPolling()
    await vi.advanceTimersByTimeAsync(0)
    mod.stopAircraftPolling()
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(h.aircraft).toHaveBeenCalledTimes(1)
  })
})

describe('bandOf', () => {
  const at = (altM: number | null, onGround = false): Aircraft => ({ ...plane('4b1814'), altM, onGround })

  it('puts on-ground and unknown-altitude aircraft on the ground band', () => {
    expect(mod.bandOf(at(11_000, true))).toBe('ground')
    expect(mod.bandOf(at(null))).toBe('ground')
  })

  it('switches bands exactly at 3000 m and 9000 m', () => {
    expect(mod.bandOf(at(0))).toBe('low')
    expect(mod.bandOf(at(2_999.9))).toBe('low')
    expect(mod.bandOf(at(3_000))).toBe('mid')
    expect(mod.bandOf(at(8_999.9))).toBe('mid')
    expect(mod.bandOf(at(9_000))).toBe('high')
  })
})

describe('visibleAircraft', () => {
  // 4b1814: Swiss civil hex, callsign TST14 → civil. ae1234: USA military hex.
  const civilHigh = plane('4b1814')
  const civilGround: Aircraft = { ...plane('4b1815'), onGround: true }
  const militaryHigh: Aircraft = { ...plane('ae1234'), callsign: 'RCH123' }
  const aircraft = [civilHigh, civilGround, militaryHigh]
  const allBands = () => new Set(mod.ALT_BANDS)
  const allCategories = () => new Set(['civil', 'cargo', 'military'] as const)

  it('returns the store array itself while every filter is on', () => {
    expect(
      mod.visibleAircraft({ aircraft, activeBands: allBands(), activeCategories: allCategories() }),
    ).toBe(aircraft)
  })

  it('filters by altitude band', () => {
    const visible = mod.visibleAircraft({
      aircraft,
      activeBands: new Set(['ground'] as const),
      activeCategories: allCategories(),
    })
    expect(visible).toEqual([civilGround])
  })

  it('filters by category', () => {
    const visible = mod.visibleAircraft({
      aircraft,
      activeBands: allBands(),
      activeCategories: new Set(['military'] as const),
    })
    expect(visible).toEqual([militaryHigh])
  })

  it('ANDs band and category filters', () => {
    const visible = mod.visibleAircraft({
      aircraft,
      activeBands: new Set(['high'] as const),
      activeCategories: new Set(['civil'] as const),
    })
    expect(visible).toEqual([civilHigh])
  })
})
