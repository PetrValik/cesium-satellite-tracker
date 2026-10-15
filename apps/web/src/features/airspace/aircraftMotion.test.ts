import { describe, expect, it } from 'vitest'
import {
  AIRCRAFT_MAX_DEAD_RECKON_MS,
  aircraftDeadReckonSec,
  aircraftPositionAt,
  aircraftVelocity,
} from './aircraftMotion'

/** Fixed state vector: 230 m/s on track 90° (due east) over the equator, climbing 10 m/s. */
const T0 = Date.UTC(2026, 9, 15, 12, 0, 0)
const PLANE = {
  latDeg: 0,
  lonDeg: 10,
  altM: 9_000 as number | null,
  velocityMs: 230 as number | null,
  trackDeg: 90 as number | null,
  verticalRateMs: 10 as number | null,
  tsMs: T0,
}
const M_PER_DEG = 111_320

const at = (a: typeof PLANE, nowMs: number) =>
  aircraftPositionAt(a, nowMs, { latDeg: 0, lonDeg: 0, altM: 0 })

describe('aircraftPositionAt', () => {
  it('moves along the track and climbs at the vertical rate', () => {
    const p = at(PLANE, T0 + 60_000)
    expect(p.lonDeg - PLANE.lonDeg).toBeCloseTo((230 * 60) / M_PER_DEG, 12)
    expect(p.latDeg).toBeCloseTo(0, 12)
    expect(p.altM).toBe(9_600)
  })

  it('does not move at all when the track is null — no guessed bearing', () => {
    const p = at({ ...PLANE, trackDeg: null }, T0 + 300_000)
    expect(p).toEqual({ latDeg: 0, lonDeg: 10, altM: 9_000 })
  })

  it('does not move at all when the ground speed is null', () => {
    const p = at({ ...PLANE, velocityMs: null }, T0 + 300_000)
    expect(p).toEqual({ latDeg: 0, lonDeg: 10, altM: 9_000 })
  })

  it('holds altitude for a null vertical rate and starts a null altitude at 0', () => {
    expect(at({ ...PLANE, verticalRateMs: null }, T0 + 60_000).altM).toBe(9_000)
    expect(at({ ...PLANE, altM: null, verticalRateMs: null }, T0 + 60_000).altM).toBe(0)
  })

  it('never descends below the ground', () => {
    expect(at({ ...PLANE, altM: 100, verticalRateMs: -20 }, T0 + 60_000).altM).toBe(0)
  })

  it('freezes a stale vector at the 15-minute extrapolation', () => {
    const capped = at(PLANE, T0 + AIRCRAFT_MAX_DEAD_RECKON_MS)
    expect(at(PLANE, T0 + 4 * AIRCRAFT_MAX_DEAD_RECKON_MS)).toEqual(capped)
    expect(capped.altM).toBe(9_000 + 10 * 900)
  })

  it('never moves a vector stamped in the future backwards', () => {
    expect(at(PLANE, T0 - 60_000)).toEqual({ latDeg: 0, lonDeg: 10, altM: 9_000 })
  })

  it('equals report + velocity · clamped dt — the layer formula — and fills `out`', () => {
    const out = { latDeg: 0, lonDeg: 0, altM: 0 }
    const plane = { ...PLANE, latDeg: 47, trackDeg: 213 }
    const v = aircraftVelocity(plane, { vLatDegS: 0, vLonDegS: 0, vAltMS: 0 })
    const dt = aircraftDeadReckonSec(plane.tsMs, T0 + 98_765)
    expect(aircraftPositionAt(plane, T0 + 98_765, out)).toBe(out)
    expect(out).toEqual({
      latDeg: plane.latDeg + v.vLatDegS * dt,
      lonDeg: plane.lonDeg + v.vLonDegS * dt,
      altM: 9_000 + v.vAltMS * dt,
    })
  })
})

describe('aircraftVelocity', () => {
  it('zeroes every component when the vector is not reckonable', () => {
    const out = { vLatDegS: 1, vLonDegS: 1, vAltMS: 1 }
    expect(aircraftVelocity({ ...PLANE, trackDeg: null }, out)).toEqual({
      vLatDegS: 0,
      vLonDegS: 0,
      vAltMS: 0,
    })
  })
})

describe('aircraftDeadReckonSec', () => {
  it('clamps to [0, AIRCRAFT_MAX_DEAD_RECKON_MS] seconds', () => {
    expect(aircraftDeadReckonSec(T0, T0 + 2_500)).toBe(2.5)
    expect(aircraftDeadReckonSec(T0, T0 - 1)).toBe(0)
    expect(aircraftDeadReckonSec(T0, T0 + 10 * AIRCRAFT_MAX_DEAD_RECKON_MS)).toBe(900)
  })
})
