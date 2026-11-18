/**
 * Different-method checks for `lib/orbital`: each number is compared against an
 * independent computation (an SGP4 sweep, Cesium's own models), never against
 * the same formula a second time.
 */

import { describe, expect, it } from 'vitest'
import { constants, propagate } from 'satellite.js'
import {
  altitudeSpanKm,
  createSatrec,
  createSatStateEcef,
  orbitalPeriodMinutes,
  perigeeApogeeKm,
  propagateEcef,
  tleEpochMs,
} from './orbital'

/** Same fixtures as orbital.test.ts. */
const ISS_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  11035-3 0  9998'
const ISS_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314'
const GEO_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339  1.00270000575314'
/** ISS line 2 rewritten to a Molniya-like orbit: e = 0.7, 2.006 rev/day, i = 63.4°, ω = 270° (69 chars). */
const HEO_TLE2 = '2 25544  63.4000 186.4276 7000000 270.0000  82.1339  2.00600000575314'

function issSatrec() {
  const satrec = createSatrec(ISS_TLE1, ISS_TLE2)
  expect(satrec).not.toBeNull()
  return satrec!
}

describe('perigeeApogeeKm vs one SGP4 orbit (different method)', () => {
  // Oracle: min/max of |r_ECI| − 6378.135 km every 10 s over one period. NOT propagateEcef's
  // geodetic altKm: for the ISS that runs 419.8–433.0 km because of Earth's flattening.
  it.each([
    ['ISS', 5, ISS_TLE2], // measured −1.4 / +3.5 km
    ['GEO', 10, GEO_TLE2], // −5.4 / +6.1
    ['HEO', 15, HEO_TLE2], // −11.2 / +9.7
  ] as const)('%s within %d km', (_name, tolKm, tle2) => {
    const satrec = createSatrec(ISS_TLE1, tle2)!
    const start = tleEpochMs(satrec)
    const periodMs = orbitalPeriodMinutes(satrec) * 60_000
    let min = Infinity
    let max = -Infinity
    for (let t = 0; t <= periodMs; t += 10_000) {
      const p = propagate(satrec, new Date(start + t))!.position
      const alt = Math.hypot(p.x, p.y, p.z) - constants.earthRadius
      min = Math.min(min, alt)
      max = Math.max(max, alt)
    }
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(satrec)
    expect(Math.abs(perigeeKm - min)).toBeLessThan(tolKm)
    expect(Math.abs(apogeeKm - max)).toBeLessThan(tolKm)
  })
})

describe('altitudeSpanKm', () => {
  it('spans the geodetic altitude NOW shows over one orbit', () => {
    const satrec = issSatrec()
    const start = tleEpochMs(satrec)
    const { lowKm, highKm } = altitudeSpanKm(satrec, start)
    expect(Math.abs(lowKm - 419.8)).toBeLessThan(1)
    expect(Math.abs(highKm - 433.0)).toBeLessThan(1)
    const s = createSatStateEcef()
    for (let ms = start; ms < start + orbitalPeriodMinutes(satrec) * 60_000; ms += 10_000) {
      const alt = propagateEcef(satrec, ms, s)!.altKm
      expect(alt).toBeGreaterThanOrEqual(lowKm - 0.5)
      expect(alt).toBeLessThanOrEqual(highKm + 0.5)
    }
  })
})
