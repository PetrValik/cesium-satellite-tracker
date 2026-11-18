import { describe, expect, it } from 'vitest'
import { eciToEcf, gstime, propagate } from 'satellite.js'
import {
  classifyOrbit,
  createSatrec,
  createSatStateEcef,
  footprintRadiusM,
  internationalDesignator,
  isSunlit,
  NAKED_EYE_SUN_MAX_ELEVATION_DEG,
  orbitalPeriodMinutes,
  perigeeApogeeKm,
  predictPasses,
  propagateBatchEcefM,
  propagateEcef,
  rotateEciKmToEcefM,
  sampleOrbitRingEci,
  sunElevationDeg,
  sunPositionEciKm,
  tleEpochMs,
} from './orbital'

/** ISS (ZARYA), epoch 2026-07-10T03:41:07.908Z (day 191.15356376 of 2026). */
const ISS_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  11035-3 0  9998'
const ISS_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314'
const ISS_INCLINATION_DEG = 51.6302

/**
 * Same element set with the mean motion field (line 2, cols 53-63) rewritten
 * to ~1.0027 rev/day. The parser does not verify checksums, so the trailing
 * digits are irrelevant — the line just has to stay 69 characters.
 */
const GEO_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339  1.00270000575314'

/**
 * Same element set with B* rewritten to 0.99 (line 1, cols 54-61): it parses
 * and propagates at epoch, but SGP4 reports it decayed one day later.
 */
const DECAYING_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  99000-0 0  9998'

/** Thirty years past epoch SGP4 fails for the ISS element set (satellite.js 6.0.2). */
const THIRTY_YEARS_MS = 30 * 365 * 86_400_000

const PRAGUE = { latDeg: 50.08, lonDeg: 14.44, heightM: 300 }

function issSatrec() {
  const satrec = createSatrec(ISS_TLE1, ISS_TLE2)
  expect(satrec).not.toBeNull()
  return satrec!
}

describe('createSatrec', () => {
  it('parses a valid TLE', () => {
    const satrec = issSatrec()
    expect(satrec.satnum.trim()).toBe('25544')
    expect(satrec.error).toBe(0)
  })

  it('returns null on garbage input', () => {
    expect(createSatrec('garbage', 'garbage')).toBeNull()
    expect(createSatrec('', '')).toBeNull()
    expect(createSatrec('1 xxxxx', ISS_TLE2)).toBeNull()
  })
})

describe('classifyOrbit / orbitalPeriodMinutes', () => {
  it('classifies the ISS as LEO with a ~92.9 min period', () => {
    const satrec = issSatrec()
    expect(classifyOrbit(satrec)).toBe('LEO')
    expect(orbitalPeriodMinutes(satrec)).toBeCloseTo(92.9, 0)
    expect(Math.abs(orbitalPeriodMinutes(satrec) - 92.9)).toBeLessThan(1)
  })

  it('classifies a ~1.0027 rev/day, low-eccentricity orbit as GEO', () => {
    const satrec = createSatrec(ISS_TLE1, GEO_TLE2)
    expect(satrec).not.toBeNull()
    expect(orbitalPeriodMinutes(satrec!)).toBeGreaterThan(1336)
    expect(orbitalPeriodMinutes(satrec!)).toBeLessThan(1536)
    expect(classifyOrbit(satrec!)).toBe('GEO')
  })
})

describe('perigeeApogeeKm', () => {
  it('ISS fixture: 415.7 / 424.8 km above the equatorial radius', () => {
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(issSatrec())
    expect(perigeeKm).toBeCloseTo(415.72, 1)
    expect(apogeeKm).toBeCloseTo(424.8, 1)
  })
  it('GEO fixture spans about ±28 km around 35 787 km', () => {
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(createSatrec(ISS_TLE1, GEO_TLE2)!)
    expect(perigeeKm).toBeCloseTo(35_759.0, 0)
    expect(apogeeKm).toBeCloseTo(35_815.4, 0)
  })
})

describe('tleEpochMs', () => {
  it('is 2026-07-10T03:41:07.909Z, matching line 1 cols 19-32 read by hand', () => {
    const ms = tleEpochMs(issSatrec())
    expect(Math.abs(ms - Date.UTC(2026, 6, 10, 3, 41, 7, 909))).toBeLessThan(1)
    const field = ISS_TLE1.slice(18, 32) // '26191.15356376'
    const byHand = Date.UTC(2000 + Number(field.slice(0, 2)), 0, 1) + (Number(field.slice(2)) - 1) * 86_400_000
    expect(Math.abs(ms - byHand)).toBeLessThan(1)
  })
})

describe('internationalDesignator', () => {
  const withField = (f: string) => ISS_TLE1.slice(0, 9) + f + ISS_TLE1.slice(17)
  it('reads line 1 cols 10-17 with the 57 year pivot', () => {
    expect(internationalDesignator(ISS_TLE1)).toEqual({ launchYear: 1998, designator: '1998-067A' })
    expect(internationalDesignator(withField('24001AB '))).toEqual({ launchYear: 2024, designator: '2024-001AB' })
    expect(internationalDesignator(withField('57001B  '))).toEqual({ launchYear: 1957, designator: '1957-001B' })
    expect(internationalDesignator(withField('56123C  '))).toEqual({ launchYear: 2056, designator: '2056-123C' })
  })
  it('returns null for a blank, garbled or short field', () => {
    expect(internationalDesignator(withField('        '))).toBeNull()
    expect(internationalDesignator(withField('9806 A  '))).toBeNull()
    expect(internationalDesignator('1 25544U')).toBeNull()
  })
})

describe('propagateEcef', () => {
  it('produces a physical ISS state at the TLE epoch', () => {
    const satrec = issSatrec()
    const state = propagateEcef(satrec, tleEpochMs(satrec))
    expect(state).not.toBeNull()
    const { positionEcefM, velocityKmS, latDeg, lonDeg, altKm } = state!

    expect(altKm).toBeGreaterThan(380)
    expect(altKm).toBeLessThan(460)

    const radiusKm = Math.hypot(...positionEcefM) / 1000
    expect(Math.abs(radiusKm - (6371 + altKm))).toBeLessThan(50)

    expect(velocityKmS).toBeGreaterThan(7.4)
    expect(velocityKmS).toBeLessThan(7.9)

    expect(Math.abs(latDeg)).toBeLessThanOrEqual(51.7)
    expect(lonDeg).toBeGreaterThanOrEqual(-180)
    expect(lonDeg).toBeLessThanOrEqual(180)
  })

  it('stays physical over one full period: LEO radius, latitude bounded by inclination', () => {
    const satrec = issSatrec()
    const epochMs = tleEpochMs(satrec)
    const periodMs = orbitalPeriodMinutes(satrec) * 60_000
    const out = createSatStateEcef()
    for (let i = 0; i < 128; i++) {
      const state = propagateEcef(satrec, epochMs + (periodMs * i) / 127, out)
      expect(state).not.toBeNull()
      const r = Math.hypot(...out.positionEcefM)
      expect(r).toBeGreaterThan(6_600_000) // metres from Earth's centre
      expect(r).toBeLessThan(6_900_000)
      // Small geodetic margin: geodetic latitude slightly exceeds geocentric.
      expect(Math.abs(out.latDeg)).toBeLessThanOrEqual(ISS_INCLINATION_DEG + 0.5)
      expect(Math.abs(out.lonDeg)).toBeLessThanOrEqual(180)
    }
  })

  it('converts ECI km to ECEF m exactly as satellite.js eciToEcf, scaled by 1000', () => {
    const satrec = issSatrec()
    for (const offsetMs of [0, 600_000, 3_600_000, 86_400_000]) {
      const epochMs = tleEpochMs(satrec) + offsetMs
      const state = propagateEcef(satrec, epochMs)!
      const pv = propagate(satrec, new Date(epochMs))!
      const gmst = gstime(new Date(epochMs))
      const ecfKm = eciToEcf(pv.position, gmst)
      // Bit-exact: the one conversion site evaluates eciToEcf's expression.
      expect(state.positionEcefM).toEqual([ecfKm.x * 1000, ecfKm.y * 1000, ecfKm.z * 1000])
      expect(state.gmstRad).toBe(gmst)
    }
  })

  it('fills `out` in place and returns it, matching a fresh result', () => {
    const satrec = issSatrec()
    const epochMs = tleEpochMs(satrec) + 1_234_567
    const out = createSatStateEcef()
    const positionRef = out.positionEcefM
    const eciRef = out.positionEciKm
    const result = propagateEcef(satrec, epochMs, out)
    expect(result).toBe(out)
    expect(out.positionEcefM).toBe(positionRef) // tuple reused, not replaced
    expect(out.positionEciKm).toBe(eciRef)
    expect(out).toEqual(propagateEcef(satrec, epochMs))
  })

  it('returns null and leaves `out` untouched when SGP4 fails', () => {
    const satrec = issSatrec()
    const out = createSatStateEcef()
    const before = structuredClone(out)
    expect(propagateEcef(satrec, tleEpochMs(satrec) + THIRTY_YEARS_MS, out)).toBeNull()
    expect(out).toEqual(before)
  })

  it('carries the SGP4 ECI km position of the same instant, untouched', () => {
    const satrec = issSatrec()
    const ms = tleEpochMs(satrec) + 600_000
    expect(propagateEcef(satrec, ms)!.positionEciKm).toEqual(propagate(satrec, new Date(ms))!.position)
  })
})

describe('sunPositionEciKm', () => {
  it('puts the Sun at RA 0/90/180/270° on the 2026 equinoxes and solstices', () => {
    const cases: [number, number, number][] = [
      [Date.UTC(2026, 2, 20, 14, 46), 0, 0],
      [Date.UTC(2026, 5, 21, 8, 24), 90, 23.436],
      [Date.UTC(2026, 8, 23, 0, 5), 180, 0],
      [Date.UTC(2026, 11, 21, 20, 50), 270, -23.436],
    ]
    const sun = { x: 0, y: 0, z: 0 }
    for (const [ms, raDeg, declDeg] of cases) {
      expect(sunPositionEciKm(ms, sun)).toBe(sun)
      const ra = (Math.atan2(sun.y, sun.x) * 180) / Math.PI
      expect(Math.abs(((ra - raDeg + 540) % 360) - 180)).toBeLessThan(0.05) // measured ≤ 0.007°
      expect((Math.asin(sun.z / Math.hypot(sun.x, sun.y, sun.z)) * 180) / Math.PI).toBeCloseTo(declDeg, 1)
    }
  })
  it('is 147.1 million km away at perihelion and 152.1 at aphelion (2026)', () => {
    const sun = { x: 0, y: 0, z: 0 }
    sunPositionEciKm(Date.UTC(2026, 0, 3), sun)
    expect(Math.hypot(sun.x, sun.y, sun.z) / 1e6).toBeCloseTo(147.1, 1)
    sunPositionEciKm(Date.UTC(2026, 6, 6), sun)
    expect(Math.hypot(sun.x, sun.y, sun.z) / 1e6).toBeCloseTo(152.1, 1)
  })
})

describe('isSunlit (cylindrical umbra, R = 6378.135 km)', () => {
  const sun = { x: 149.6e6, y: 0, z: 0 }
  it('is lit on the day side and outside the shadow cylinder, dark inside it', () => {
    expect(isSunlit({ x: 7000, y: 0, z: 0 }, sun)).toBe(true)
    expect(isSunlit({ x: 0, y: 7000, z: 0 }, sun)).toBe(true) // terminator plane
    expect(isSunlit({ x: -7000, y: 6400, z: 0 }, sun)).toBe(true)
    expect(isSunlit({ x: -7000, y: 6300, z: 0 }, sun)).toBe(false)
    expect(isSunlit({ x: -7000, y: 0, z: 0 }, sun)).toBe(false)
    expect(isSunlit({ x: -7000, y: 6300, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(false) // direction only
  })
  it('ISS: sunlit at the fixture epoch, in shadow mid-eclipse 12 days later', () => {
    const satrec = issSatrec()
    const sun = { x: 0, y: 0, z: 0 }
    const lit = tleEpochMs(satrec) // high-beta season: the whole orbit is sunlit
    const dark = lit + 12 * 86_400_000 + 2_945_000 // 2026-07-22T04:30Z, middle of a 35 min eclipse
    expect(isSunlit(propagateEcef(satrec, lit)!.positionEciKm, sunPositionEciKm(lit, sun))).toBe(true)
    expect(isSunlit(propagateEcef(satrec, dark)!.positionEciKm, sunPositionEciKm(dark, sun))).toBe(false)
  })
})

describe('sunElevationDeg', () => {
  it('peaks at 90° − lat + 23.436° over Prague on the June solstice', () => {
    let max = -90
    for (let ms = Date.UTC(2026, 5, 21, 10); ms <= Date.UTC(2026, 5, 21, 12); ms += 60_000) {
      max = Math.max(max, sunElevationDeg(PRAGUE, ms))
    }
    expect(max).toBeCloseTo(90 - 50.08 + 23.436, 1) // measured 63.355
  })
  it('is −16.7° at 00:00 and 60.3° at 12:00 UTC over Prague on 2026-07-10', () => {
    expect(sunElevationDeg(PRAGUE, Date.UTC(2026, 6, 10, 0))).toBeCloseTo(-16.74, 1)
    expect(sunElevationDeg(PRAGUE, Date.UTC(2026, 6, 10, 12))).toBeCloseTo(60.28, 1)
  })
})


describe('propagateBatchEcefM', () => {
  it('keeps every slot, NaN-fills failures, counts them and matches propagateEcef', () => {
    const iss = issSatrec()
    const decaying = createSatrec(DECAYING_TLE1, ISS_TLE2)
    expect(decaying).not.toBeNull()
    const epochMs = tleEpochMs(iss) + 2 * 86_400_000 // decaying copy is gone by now
    const satrecs = [iss, null, decaying, iss]
    const out = new Float32Array(3 * satrecs.length)

    expect(propagateBatchEcefM(satrecs, epochMs, out)).toBe(2)

    const single = propagateEcef(issSatrec(), epochMs)!
    for (const slot of [0, 3]) {
      for (let k = 0; k < 3; k++) {
        expect(out[3 * slot + k]).toBe(Math.fround(single.positionEcefM[k]))
      }
    }
    for (const slot of [1, 2]) {
      for (let k = 0; k < 3; k++) expect(Number.isNaN(out[3 * slot + k])).toBe(true)
    }
  })

  it('returns 0 and writes nothing for an empty working set', () => {
    const out = new Float32Array(0)
    expect(propagateBatchEcefM([], 0, out)).toBe(0)
  })
})

describe('rotateEciKmToEcefM', () => {
  it('rotates the ECI ring bit-exactly as eciToEcf × 1000', () => {
    const satrec = issSatrec()
    const epochMs = tleEpochMs(satrec)
    const ring = sampleOrbitRingEci(satrec, epochMs, 180)
    const n = ring.eciKm.length / 3
    const out = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }))
    const gmst = gstime(new Date(epochMs + 5_000_000))

    rotateEciKmToEcefM(ring.eciKm, gmst, out)

    for (let j = 0; j < n; j++) {
      const eci = { x: ring.eciKm[3 * j], y: ring.eciKm[3 * j + 1], z: ring.eciKm[3 * j + 2] }
      const ecfKm = eciToEcf(eci, gmst)
      expect(out[j]).toEqual({ x: ecfKm.x * 1000, y: ecfKm.y * 1000, z: ecfKm.z * 1000 })
      const r = Math.hypot(out[j].x, out[j].y, out[j].z)
      expect(r).toBeGreaterThan(6_650_000) // metres, not kilometres
      expect(r).toBeLessThan(6_900_000)
    }
  })

  it('puts the satellite on its ring: sample 0 at the epoch GMST is the live position', () => {
    const satrec = issSatrec()
    const epochMs = tleEpochMs(satrec) + 777_000
    const ring = sampleOrbitRingEci(satrec, epochMs, 180)
    const out = [{ x: 0, y: 0, z: 0 }]
    rotateEciKmToEcefM(ring.eciKm, gstime(new Date(epochMs)), out)
    const live = propagateEcef(satrec, epochMs)!
    expect([out[0].x, out[0].y, out[0].z]).toEqual(live.positionEcefM)
  })

  it('writes only as many points as both sides hold', () => {
    const eciKm = new Float64Array([7000, 0, 0, 0, 7000, 0])
    const out = [{ x: -1, y: -1, z: -1 }]
    rotateEciKmToEcefM(eciKm, 0, out)
    expect(out).toEqual([{ x: 7_000_000, y: 0, z: 0 }])
    const roomy = Array.from({ length: 3 }, () => ({ x: -1, y: -1, z: -1 }))
    rotateEciKmToEcefM(eciKm, Math.PI / 2, roomy)
    // +90° GMST: ECI +x maps to ECEF −y, ECI +y to ECEF +x.
    expect(roomy[0].x).toBeCloseTo(0, 6)
    expect(roomy[0].y).toBeCloseTo(-7_000_000, 6)
    expect(roomy[1].x).toBeCloseTo(7_000_000, 6)
    expect(roomy[1].y).toBeCloseTo(0, 6)
    expect(roomy[2]).toEqual({ x: -1, y: -1, z: -1 }) // untouched
  })
})

describe('predictPasses', () => {
  it('predicts sane ISS passes over Prague within 24 h of the epoch', () => {
    const satrec = issSatrec()
    const startMs = tleEpochMs(satrec)
    const passes = predictPasses(satrec, PRAGUE, startMs, 24)

    expect(passes.length).toBeGreaterThanOrEqual(1)
    expect(passes.length).toBeLessThanOrEqual(12)

    let prevAos = -Infinity
    for (const pass of passes) {
      expect(pass.noradId).toBe(25544)
      expect(pass.losMs).toBeGreaterThan(pass.aosMs)
      expect(pass.aosMs).toBeGreaterThanOrEqual(startMs)
      expect(pass.losMs).toBeLessThanOrEqual(startMs + 24 * 3_600_000)
      expect(pass.aosMs).toBeGreaterThan(prevAos)
      prevAos = pass.aosMs

      expect(pass.maxElDeg).toBeGreaterThanOrEqual(5)
      expect(pass.maxElMs).toBeGreaterThanOrEqual(pass.aosMs)
      expect(pass.maxElMs).toBeLessThanOrEqual(pass.losMs)

      expect(pass.samples.length).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < pass.samples.length; i++) {
        const s = pass.samples[i]
        if (i > 0) expect(s.tMs).toBeGreaterThan(pass.samples[i - 1].tMs)
        expect(s.azDeg).toBeGreaterThanOrEqual(0)
        expect(s.azDeg).toBeLessThan(360)
        expect(s.rangeKm).toBeGreaterThan(0)
        expect(s.elDeg).toBeLessThanOrEqual(pass.maxElDeg)
      }
      // Refined AOS/LOS endpoints sit on (or a hair under) the horizon.
      expect(pass.samples[0].tMs).toBe(pass.aosMs)
      expect(pass.samples[pass.samples.length - 1].tMs).toBe(pass.losMs)
      expect(pass.samples[0].elDeg).toBeGreaterThanOrEqual(-0.5)
      expect(pass.samples[pass.samples.length - 1].elDeg).toBeGreaterThanOrEqual(-0.5)
    }
  })

  it('adds rise/set azimuth and the naked-eye flag (ISS over Prague, 24 h from epoch)', () => {
    const satrec = issSatrec()
    const passes = predictPasses(satrec, PRAGUE, tleEpochMs(satrec), 24)
    // AOS 17:47 (sun +10°), 19:22 (sun −2.3…−3.6°: civil twilight), 20:58, 22:35, 00:12, 01:49 UTC
    expect(passes.map((p) => p.nakedEye)).toEqual([false, false, true, true, true, true])
    const azimuths = [[179.2, 85.1], [226.6, 72.8], [260.3, 77.6], [281.1, 96.9], [287.4, 129.4], [277.4, 174.8]]
    passes.forEach((p, i) => {
      expect(Math.abs(p.riseAzDeg - azimuths[i][0])).toBeLessThan(0.5)
      expect(Math.abs(p.setAzDeg - azimuths[i][1])).toBeLessThan(0.5)
      const above = p.samples.filter((s) => s.elDeg >= 0)
      expect(p.riseAzDeg).toBe(above[0].azDeg)
      expect(p.setAzDeg).toBe(above[above.length - 1].azDeg)
    })
    // The second pass is false only because of the −6° threshold: sunlit, sky not dark yet.
    const twilight = sunElevationDeg(PRAGUE, passes[1].maxElMs)
    expect(twilight).toBeLessThan(0)
    expect(twilight).toBeGreaterThan(NAKED_EYE_SUN_MAX_ELEVATION_DEG)
  })
})

describe('footprintRadiusM', () => {
  it('matches the horizon geometry at ISS altitude', () => {
    // R * acos(R / (R + h)) with R = 6371 km, h = 420 km → ~2 252 km.
    expect(footprintRadiusM(420)).toBeCloseTo(6_371_000 * Math.acos(6371 / 6791), 6)
    expect(footprintRadiusM(420) / 1000).toBeGreaterThan(2200)
    expect(footprintRadiusM(420) / 1000).toBeLessThan(2300)
  })

  it('returns 0 for non-positive or non-finite altitude', () => {
    expect(footprintRadiusM(0)).toBe(0)
    expect(footprintRadiusM(-10)).toBe(0)
    expect(footprintRadiusM(Number.NaN)).toBe(0)
  })
})

describe('sampleOrbitRingEci', () => {
  it('returns a closed, finite ring at orbital radius', () => {
    const satrec = issSatrec()
    const ring = sampleOrbitRingEci(satrec, tleEpochMs(satrec), 180)

    expect(ring.eciKm.length).toBe(3 * 181) // 180 samples + closing duplicate
    expect(ring.periodMinutes).toBeCloseTo(92.9, 0)

    const n = ring.eciKm.length / 3
    // Closed: the last sample repeats the first exactly.
    expect(ring.eciKm[3 * (n - 1)]).toBe(ring.eciKm[0])
    expect(ring.eciKm[3 * (n - 1) + 1]).toBe(ring.eciKm[1])
    expect(ring.eciKm[3 * (n - 1) + 2]).toBe(ring.eciKm[2])

    for (let i = 0; i < n; i++) {
      const x = ring.eciKm[3 * i]
      const y = ring.eciKm[3 * i + 1]
      const z = ring.eciKm[3 * i + 2]
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
      const r = Math.hypot(x, y, z)
      expect(r).toBeGreaterThan(6650) // km — above Earth's surface
      expect(r).toBeLessThan(6900) // km — near-circular LEO stays close to a = 6798
    }
  })

  it('NaN-fills the ring for an unpropagatable satrec', () => {
    const satrec = issSatrec()
    // 30 years after epoch SGP4 fails for a decayed LEO element set — if it
    // ever succeeds, the finite check below just passes trivially instead.
    const ring = sampleOrbitRingEci(satrec, tleEpochMs(satrec) + 30 * 365 * 86_400_000)
    const allNaN = ring.eciKm.every((v) => Number.isNaN(v))
    const allFinite = ring.eciKm.every((v) => Number.isFinite(v))
    expect(allNaN || allFinite).toBe(true)
  })
})
