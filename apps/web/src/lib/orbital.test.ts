import { describe, expect, it } from 'vitest'
import {
  classifyOrbit,
  createSatrec,
  footprintRadiusM,
  orbitalPeriodMinutes,
  predictPasses,
  propagateEcef,
  sampleOrbitTrack,
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

/** Julian date of the Unix epoch. */
const JD_UNIX_EPOCH = 2440587.5

const PRAGUE = { latDeg: 50.08, lonDeg: 14.44, heightM: 300 }

function issSatrec() {
  const satrec = createSatrec(ISS_TLE1, ISS_TLE2)
  expect(satrec).not.toBeNull()
  return satrec!
}

/** TLE epoch as Unix ms, derived from the parsed element set (deterministic). */
function tleEpochMs(satrec: { jdsatepoch: number }): number {
  return (satrec.jdsatepoch - JD_UNIX_EPOCH) * 86_400_000
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
})

describe('sampleOrbitTrack', () => {
  it('returns finite arrays of the requested length over one period', () => {
    const satrec = issSatrec()
    const samples = 128
    const track = sampleOrbitTrack(satrec, tleEpochMs(satrec), samples)

    expect(track.orbitEcef).toHaveLength(3 * samples)
    expect(track.groundTrack).toHaveLength(2 * samples)
    expect(track.periodMinutes).toBeCloseTo(orbitalPeriodMinutes(satrec), 10)

    for (let i = 0; i < track.orbitEcef.length; i++) {
      expect(Number.isFinite(track.orbitEcef[i])).toBe(true)
    }
    // Every position should sit at LEO altitude (meters from Earth center).
    for (let i = 0; i < samples; i++) {
      const r = Math.hypot(
        track.orbitEcef[3 * i],
        track.orbitEcef[3 * i + 1],
        track.orbitEcef[3 * i + 2],
      )
      expect(r).toBeGreaterThan(6_600_000)
      expect(r).toBeLessThan(6_900_000)
    }
    // Ground-track latitude is bounded by the inclination (small geodetic
    // margin: geodetic latitude slightly exceeds geocentric latitude).
    for (let i = 0; i < samples; i++) {
      const lon = track.groundTrack[2 * i]
      const lat = track.groundTrack[2 * i + 1]
      expect(Number.isFinite(lon)).toBe(true)
      expect(Number.isFinite(lat)).toBe(true)
      expect(Math.abs(lat)).toBeLessThanOrEqual(ISS_INCLINATION_DEG + 0.5)
      expect(Math.abs(lon)).toBeLessThanOrEqual(180)
    }
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
