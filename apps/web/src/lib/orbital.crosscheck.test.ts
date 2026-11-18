/**
 * Different-method checks for `lib/orbital`: each number is compared against an
 * independent computation (an SGP4 sweep, Cesium's own models), never against
 * the same formula a second time.
 */

import { describe, expect, it } from 'vitest'
import {
  Cartesian3,
  Ellipsoid,
  JulianDate,
  Matrix3,
  Simon1994PlanetaryPositions,
  Transforms,
} from 'cesium'
import * as cesium from 'cesium'
import { constants, eciToEcf, gstime, jday, propagate, sunPos } from 'satellite.js'
import {
  altitudeSpanKm,
  createSatrec,
  createSatStateEcef,
  isSunlit,
  orbitalPeriodMinutes,
  perigeeApogeeKm,
  propagateEcef,
  sunPositionEciKm,
  tleEpochMs,
  type Vec3Like,
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

/**
 * Cesium's horizon-culling occluder (the globe's own ellipsoidal shadow test). It is exported at
 * runtime but marked `@private`, so Cesium.d.ts leaves it out: typed here by hand.
 */
const { EllipsoidalOccluder } = cesium as unknown as {
  EllipsoidalOccluder: new (ellipsoid: Ellipsoid, cameraPosition: Cartesian3) => {
    isPointVisible(occludee: Cartesian3): boolean
  }
}

/** The Sun Cesium lights the globe with (createViewer.ts:161): Simon 1994, ICRF → fixed via the
 *  TEME fallback (no EOP data is loaded), ECEF metres. */
function cesiumSunEcefM(ms: number): Cartesian3 {
  const jd = JulianDate.fromDate(new Date(ms))
  const inertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(jd)
  return Matrix3.multiplyByVector(Transforms.computeTemeToPseudoFixedMatrix(jd), inertial, new Cartesian3())
}
const angleDeg = (a: Vec3Like, b: Vec3Like) =>
  (Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)))) * 180) / Math.PI

describe('Sun and shadow vs Cesium (different method)', () => {
  const iss = createSatrec(ISS_TLE1, ISS_TLE2)!
  const E = tleEpochMs(iss)
  it("sun direction within 0.5° of Cesium's at six instants", () => {
    for (const ms of [E, Date.UTC(2026, 2, 20, 14, 46), Date.UTC(2026, 5, 21, 8, 24), Date.UTC(2026, 8, 23, 0, 5), Date.UTC(2026, 11, 21, 20, 50), Date.UTC(2026, 10, 18, 12)]) {
      const ecf = eciToEcf(sunPositionEciKm(ms, { x: 0, y: 0, z: 0 }), gstime(new Date(ms)))
      expect(angleDeg(ecf, cesiumSunEcefM(ms))).toBeLessThan(0.5) // measured 0.363–0.371° (precession Cesium omits)
    }
  })
  it('canary: satellite.js 6.0.2 sunPos is more than 1° off at the fixture epoch (why lib/orbital has its own)', () => {
    const r = sunPos(jday(new Date(E))).rsun
    expect(angleDeg(eciToEcf({ x: r[0], y: r[1], z: r[2] }, gstime(new Date(E))), cesiumSunEcefM(E))).toBeGreaterThan(1) // measured 1.40°
  })
  it("shadow flag matches Cesium's ellipsoidal occluder over one orbit", () => {
    const periodMs = orbitalPeriodMinutes(iss) * 60_000
    const sun = { x: 0, y: 0, z: 0 }
    const count = (start: number) => {
      let ours = 0, disagree = 0, sunPosShadow = 0
      for (let t = 0; t < periodMs; t += 10_000) {
        const ms = start + t
        const s = propagateEcef(iss, ms)!
        const mine = isSunlit(s.positionEciKm, sunPositionEciKm(ms, sun))
        const cesium = new EllipsoidalOccluder(Ellipsoid.WGS84, cesiumSunEcefM(ms)).isPointVisible(Cartesian3.fromArray(s.positionEcefM))
        const r = sunPos(jday(new Date(ms))).rsun
        if (!isSunlit(s.positionEciKm, { x: r[0], y: r[1], z: r[2] })) sunPosShadow++
        if (!mine) ours++
        if (mine !== cesium) disagree++
      }
      return { ours, disagree, sunPosShadow }
    }
    const epoch = count(E) // measured: ours 0, Cesium 0, sunPos 22 (the known-bad input this oracle catches)
    expect(epoch.ours).toBe(0)
    expect(epoch.disagree).toBe(0)
    expect(epoch.sunPosShadow).toBeGreaterThanOrEqual(20)
    const later = count(E + 12 * 86_400_000) // measured: 214 shadow samples, 2 disagree (sphere vs WGS84 at the edge)
    expect(later.ours).toBeGreaterThanOrEqual(150)
    expect(later.disagree).toBeLessThanOrEqual(3)
  })
})
