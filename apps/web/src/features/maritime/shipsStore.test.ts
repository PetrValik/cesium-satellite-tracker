import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHIP_TYPES, ShipListSchema, type Ship } from '@orbital-ops/shared'

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
  return { ApiError: MockApiError, ships: vi.fn() }
})

vi.mock('../../lib/api', () => ({ ApiError: h.ApiError, api: { ships: h.ships } }))

const POLL_MS = 10_000
const UNCONFIGURED_RECHECK_TICKS = 30

const ship = (mmsi: number, shipType: Ship['shipType']): Ship => ({
  mmsi,
  name: `SHIP ${mmsi}`,
  latDeg: 51.9,
  lonDeg: 4.1,
  sogKn: 12.3,
  cogDeg: 245.1,
  hdgDeg: 243,
  shipType,
  tsMs: 0,
})

// The module owns the interval timer and the backoff counter — re-import it
// fresh per test so that state cannot leak between tests.
type ShipsModule = typeof import('./shipsStore')
let mod: ShipsModule

beforeEach(async () => {
  vi.useFakeTimers()
  h.ships.mockReset()
  vi.resetModules()
  mod = await import('./shipsStore')
})

afterEach(() => {
  mod.stopShipsPolling()
  vi.useRealTimers()
})

describe('shipsStore polling', () => {
  it('populates ships, byMmsi, and countsByType on a successful poll', async () => {
    h.ships.mockResolvedValue([ship(1, 'cargo'), ship(2, 'tanker'), ship(3, 'cargo')])

    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)

    const s = mod.useShips.getState()
    expect(s.ships).toHaveLength(3)
    expect(s.byMmsi.get(2)?.shipType).toBe('tanker')
    expect(s.byMmsi.get(2)?.hdgDeg).toBe(243)
    expect(s.countsByType).toEqual({ cargo: 2, tanker: 1 })
    expect(s.configured).toBe(true)
    expect(s.connected).toBe(true)
  })

  it('backs off after a 503 (feed unconfigured) instead of polling every tick', async () => {
    h.ships.mockRejectedValue(new h.ApiError('AIS feed not configured', 503))

    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(mod.useShips.getState().configured).toBe(false)
    expect(mod.useShips.getState().connected).toBe(false)
    expect(h.ships).toHaveBeenCalledTimes(1)

    // every tick inside the recheck window is suppressed
    await vi.advanceTimersByTimeAsync(UNCONFIGURED_RECHECK_TICKS * POLL_MS)
    expect(h.ships).toHaveBeenCalledTimes(1)

    // the first tick after the counter elapses re-checks the feed
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.ships).toHaveBeenCalledTimes(2)
  })

  it('keeps retrying every tick on a network error (no backoff)', async () => {
    h.ships.mockRejectedValue(new h.ApiError('API unreachable', null))

    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)
    // Unreachable is not "unconfigured": only a 503 may claim the key is missing.
    expect(mod.useShips.getState().configured).toBeNull()
    expect(mod.useShips.getState().connected).toBe(false)
    expect(h.ships).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.ships).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(h.ships).toHaveBeenCalledTimes(3)
  })
})

describe('shipsStore poll failures', () => {
  it('a 5xx after a good poll keeps the snapshot and the configured flag', async () => {
    h.ships.mockResolvedValueOnce([ship(1, 'cargo')])
    h.ships.mockRejectedValueOnce(new h.ApiError('Bad Gateway', 502))

    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(POLL_MS)

    const s = mod.useShips.getState()
    expect(h.ships).toHaveBeenCalledTimes(2)
    expect(s.configured).toBe(true)
    expect(s.connected).toBe(false)
    expect(s.ships).toHaveLength(1)
  })

  it('logs a contract break (non-ApiError) instead of reporting the feed unconfigured', async () => {
    const drift = new Error('zod: expected number, received string')
    h.ships.mockRejectedValue(drift)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)

    expect(log).toHaveBeenCalledWith(expect.any(String), drift)
    expect(mod.useShips.getState().configured).toBeNull()
    expect(mod.useShips.getState().connected).toBe(false)
    log.mockRestore()
  })

  it('stopShipsPolling clears the interval', async () => {
    h.ships.mockResolvedValue([])
    mod.startShipsPolling()
    await vi.advanceTimersByTimeAsync(0)
    mod.stopShipsPolling()
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(h.ships).toHaveBeenCalledTimes(1)
  })
})

describe('visibleShips', () => {
  const ships = [ship(1, 'cargo'), ship(2, 'tanker'), ship(3, 'fishing')]

  it('returns the store array itself while every type is on', () => {
    expect(mod.visibleShips({ ships, activeTypes: new Set(SHIP_TYPES) })).toBe(ships)
  })

  it('keeps only the active types', () => {
    const visible = mod.visibleShips({ ships, activeTypes: new Set(['cargo', 'fishing'] as const) })
    expect(visible.map((s) => s.mmsi)).toEqual([1, 3])
  })

  it('is empty with every type off', () => {
    expect(mod.visibleShips({ ships, activeTypes: new Set() })).toEqual([])
  })
})

describe('ship fixtures', () => {
  // The real feed path validates with ShipListSchema (lib/api). Parsing the
  // fixture through the same schema guards these tests against contract
  // drift — a Ship field added to packages/shared fails here, not silently.
  it('satisfy ShipListSchema, including nullable hdgDeg', () => {
    const parsed = ShipListSchema.parse([ship(1, 'cargo'), { ...ship(2, 'tanker'), hdgDeg: null }])
    expect(parsed[0].hdgDeg).toBe(243)
    expect(parsed[1].hdgDeg).toBeNull()
  })
})
