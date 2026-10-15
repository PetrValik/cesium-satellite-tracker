import { describe, expect, it } from 'vitest'
import {
  SHIP_MAX_DEAD_RECKON_MS,
  shipBearingDeg,
  shipDeadReckonSec,
  shipPositionAt,
  shipVelocity,
} from './shipMotion'

/** Fixed report: 12 kn, COG 0° (due north), bow at 90° — set across a current. */
const T0 = Date.UTC(2026, 9, 15, 12, 0, 0)
const SHIP = { latDeg: 50, lonDeg: 14, sogKn: 12, cogDeg: 0, hdgDeg: 90, tsMs: T0 }
const KN = 0.514444
const M_PER_DEG = 111_320

const at = (ship: typeof SHIP, nowMs: number) => shipPositionAt(ship, nowMs, { latDeg: 0, lonDeg: 0 })

describe('shipPositionAt', () => {
  it('moves along COG, never along the heading', () => {
    const p = at(SHIP, T0 + 60_000)
    expect(p.latDeg - SHIP.latDeg).toBeCloseTo((12 * KN * 60) / M_PER_DEG, 12)
    expect(p.lonDeg).toBe(SHIP.lonDeg) // heading 90° did not push it east
  })

  it('scales the longitude step by 1/cos(lat)', () => {
    const east = { ...SHIP, latDeg: 60, cogDeg: 90 }
    const p = at(east, T0 + 60_000)
    expect(p.lonDeg - east.lonDeg).toBeCloseTo((2 * 12 * KN * 60) / M_PER_DEG, 10)
    expect(p.latDeg).toBeCloseTo(east.latDeg, 10)
  })

  it('leaves a moored vessel (sog < 0.2 kn) at its report', () => {
    const moored = { ...SHIP, sogKn: 0.19 }
    expect(at(moored, T0 + 600_000)).toEqual({ latDeg: 50, lonDeg: 14 })
    expect(at({ ...SHIP, sogKn: 0.2 }, T0 + 600_000).latDeg).toBeGreaterThan(50)
  })

  it('freezes a stale report at the 30-minute extrapolation', () => {
    const capped = at(SHIP, T0 + SHIP_MAX_DEAD_RECKON_MS)
    expect(at(SHIP, T0 + 6 * SHIP_MAX_DEAD_RECKON_MS)).toEqual(capped)
    expect(capped.latDeg - SHIP.latDeg).toBeCloseTo((12 * KN * 1800) / M_PER_DEG, 12)
  })

  it('never moves a report stamped in the future backwards', () => {
    expect(at(SHIP, T0 - 60_000)).toEqual({ latDeg: 50, lonDeg: 14 })
  })

  it('stays finite for a (data-error) report at a pole', () => {
    const p = at({ ...SHIP, latDeg: 90, cogDeg: 90 }, T0 + 60_000)
    expect(Number.isFinite(p.lonDeg)).toBe(true)
  })

  it('equals report + velocity · clamped dt — the layer formula — and fills `out`', () => {
    const out = { latDeg: 0, lonDeg: 0 }
    const ship = { ...SHIP, cogDeg: 37 }
    const v = shipVelocity(ship, { vLatDegS: 0, vLonDegS: 0 })
    const dt = shipDeadReckonSec(ship.tsMs, T0 + 123_456)
    expect(shipPositionAt(ship, T0 + 123_456, out)).toBe(out)
    expect(out).toEqual({ latDeg: ship.latDeg + v.vLatDegS * dt, lonDeg: ship.lonDeg + v.vLonDegS * dt })
  })
})

describe('shipDeadReckonSec', () => {
  it('clamps to [0, SHIP_MAX_DEAD_RECKON_MS] seconds', () => {
    expect(shipDeadReckonSec(T0, T0 + 1_500)).toBe(1.5)
    expect(shipDeadReckonSec(T0, T0 - 1)).toBe(0)
    expect(shipDeadReckonSec(T0, T0 + 10 * SHIP_MAX_DEAD_RECKON_MS)).toBe(SHIP_MAX_DEAD_RECKON_MS / 1000)
  })
})

describe('shipBearingDeg', () => {
  it('prefers the true heading, even when moored', () => {
    expect(shipBearingDeg(SHIP)).toBe(90)
    expect(shipBearingDeg({ ...SHIP, sogKn: 0 })).toBe(90)
  })

  it('falls back to COG only above steerageway, else null', () => {
    expect(shipBearingDeg({ ...SHIP, hdgDeg: null })).toBe(0)
    expect(shipBearingDeg({ ...SHIP, hdgDeg: null, sogKn: 0.1 })).toBeNull()
  })
})
