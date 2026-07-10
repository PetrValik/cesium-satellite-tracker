/**
 * Pure orbital-mechanics functions shared by the propagation worker and the
 * main thread. Unit discipline:
 *   - satellite.js speaks ECI (TEME) kilometers and km/s; geodetic radians.
 *   - Everything exported here speaks ECEF **meters** and **degrees** (except
 *     velocity/range/altitude which stay km-based, as the protocol requires).
 * The km→m conversion happens in exactly one place: `propagateEcef`.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  ecfToLookAngles,
} from 'satellite.js'
import type { SatRec, GeodeticLocation, EciVec3 } from 'satellite.js'
import type { ObserverGeo, OrbitClass, PassPrediction, PassSample } from './protocol'

const KM_TO_M = 1000
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const EARTH_RADIUS_M = 6_371_000

/** Coarse elevation-scan step for pass prediction. */
const COARSE_STEP_MS = 30_000
/** AOS/LOS bisection tolerance. */
const REFINE_TOLERANCE_MS = 1_000
/** Passes peaking below this elevation are discarded. */
const MIN_MAX_ELEVATION_DEG = 5
/** Safety cap on the number of predicted passes per request. */
const MAX_PASSES = 50

export interface SatStateEcef {
  /** ECEF position [x, y, z], meters. */
  positionEcefM: [number, number, number]
  /** Speed (magnitude of ECI velocity), km/s. */
  velocityKmS: number
  latDeg: number
  lonDeg: number
  altKm: number
}

export interface OrbitTrack {
  /** ECEF meters, layout [x0,y0,z0, x1,y1,z1, ...]. */
  orbitEcef: Float64Array
  /** [lonDeg, latDeg] pairs, same sample times as orbitEcef. */
  groundTrack: Float64Array
  periodMinutes: number
}

function isFiniteVec(v: EciVec3<number>): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

/**
 * Parse a TLE into a satrec, or null when the element set is unusable.
 * satellite.js does not throw on garbage input — it produces NaN fields —
 * so validity is checked explicitly.
 */
export function createSatrec(tle1: string, tle2: string): SatRec | null {
  try {
    const satrec = twoline2satrec(tle1, tle2)
    if (satrec.error !== 0) return null
    if (!Number.isFinite(satrec.no) || satrec.no <= 0) return null
    if (
      !Number.isFinite(satrec.ecco) ||
      !Number.isFinite(satrec.inclo) ||
      !Number.isFinite(satrec.jdsatepoch)
    ) {
      return null
    }
    return satrec
  } catch {
    return null
  }
}

/** Orbital period in minutes. satrec.no is mean motion in radians/minute. */
export function orbitalPeriodMinutes(satrec: SatRec): number {
  return (2 * Math.PI) / satrec.no
}

/**
 * Classify once at catalog load, not per frame.
 * HEO if ecc > 0.25; GEO if period within 1436±100 min and ecc < 0.1;
 * LEO if period < 128 min; else MEO.
 */
export function classifyOrbit(satrec: SatRec): OrbitClass {
  const period = orbitalPeriodMinutes(satrec)
  const ecc = satrec.ecco
  if (ecc > 0.25) return 'HEO'
  if (Math.abs(period - 1436) <= 100 && ecc < 0.1) return 'GEO'
  if (period < 128) return 'LEO'
  return 'MEO'
}

/**
 * Propagate to `epochMs` and convert to Cesium-ready ECEF meters plus
 * geodetic degrees. GMST is computed for the same instant as the propagation.
 * Returns null when SGP4 fails or produces non-finite output.
 */
export function propagateEcef(satrec: SatRec, epochMs: number): SatStateEcef | null {
  const date = new Date(epochMs)
  const pv = propagate(satrec, date)
  if (!pv || !isFiniteVec(pv.position) || !isFiniteVec(pv.velocity)) return null

  const gmst = gstime(date)
  const ecf = eciToEcf(pv.position, gmst)
  const geo = eciToGeodetic(pv.position, gmst)
  const latDeg = geo.latitude * RAD_TO_DEG
  const lonDeg = geo.longitude * RAD_TO_DEG
  if (
    !isFiniteVec(ecf) ||
    !Number.isFinite(latDeg) ||
    !Number.isFinite(lonDeg) ||
    !Number.isFinite(geo.height)
  ) {
    return null
  }

  return {
    positionEcefM: [ecf.x * KM_TO_M, ecf.y * KM_TO_M, ecf.z * KM_TO_M],
    velocityKmS: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
    latDeg,
    lonDeg,
    altKm: geo.height,
  }
}

/**
 * Sample one full orbital period starting at `epochMs`. Each sample is
 * propagated at its own time with its own GMST, so the ECEF path curves with
 * Earth rotation (where the satellite will actually be over the ground).
 * Non-finite samples carry the last good value forward (or the first good
 * value backward); if every sample fails, the arrays are NaN-filled.
 */
export function sampleOrbitTrack(
  satrec: SatRec,
  epochMs: number,
  samples = 128,
): OrbitTrack {
  const n = Math.max(2, Math.floor(samples))
  const periodMinutes = orbitalPeriodMinutes(satrec)
  const periodMs = periodMinutes * 60_000
  const orbitEcef = new Float64Array(3 * n)
  const groundTrack = new Float64Array(2 * n)

  let lastGood = -1
  const pendingBackfill: number[] = []

  const copySample = (from: number, to: number): void => {
    orbitEcef[3 * to] = orbitEcef[3 * from]
    orbitEcef[3 * to + 1] = orbitEcef[3 * from + 1]
    orbitEcef[3 * to + 2] = orbitEcef[3 * from + 2]
    groundTrack[2 * to] = groundTrack[2 * from]
    groundTrack[2 * to + 1] = groundTrack[2 * from + 1]
  }

  for (let i = 0; i < n; i++) {
    const tMs = epochMs + (periodMs * i) / (n - 1)
    const state = propagateEcef(satrec, tMs)
    if (state) {
      orbitEcef[3 * i] = state.positionEcefM[0]
      orbitEcef[3 * i + 1] = state.positionEcefM[1]
      orbitEcef[3 * i + 2] = state.positionEcefM[2]
      groundTrack[2 * i] = state.lonDeg
      groundTrack[2 * i + 1] = state.latDeg
      for (const j of pendingBackfill) copySample(i, j)
      pendingBackfill.length = 0
      lastGood = i
    } else if (lastGood >= 0) {
      copySample(lastGood, i)
    } else {
      pendingBackfill.push(i)
    }
  }

  if (lastGood < 0) {
    orbitEcef.fill(Number.NaN)
    groundTrack.fill(Number.NaN)
  }

  return { orbitEcef, groundTrack, periodMinutes }
}

/**
 * Great-circle radius (meters) of the ground area from which the satellite is
 * above the geometric horizon: R * acos(R / (R + alt)).
 */
export function footprintRadiusM(altKm: number): number {
  if (!Number.isFinite(altKm) || altKm <= 0) return 0
  return EARTH_RADIUS_M * Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + altKm * KM_TO_M))
}

interface LookSample {
  azDeg: number
  elDeg: number
  rangeKm: number
}

/** Look angles at one instant; null when propagation fails. */
function lookAnglesAt(
  satrec: SatRec,
  observerGd: GeodeticLocation,
  tMs: number,
): LookSample | null {
  const date = new Date(tMs)
  const pv = propagate(satrec, date)
  if (!pv || !isFiniteVec(pv.position)) return null
  const gmst = gstime(date)
  // Look angles are computed in km — no meter conversion on this path.
  const ecf = eciToEcf(pv.position, gmst)
  const look = ecfToLookAngles(observerGd, ecf)
  const elDeg = look.elevation * RAD_TO_DEG
  let azDeg = (look.azimuth * RAD_TO_DEG) % 360
  if (azDeg < 0) azDeg += 360
  if (azDeg >= 360) azDeg = 0
  if (!Number.isFinite(elDeg) || !Number.isFinite(azDeg) || !Number.isFinite(look.rangeSat)) {
    return null
  }
  return { azDeg, elDeg, rangeKm: look.rangeSat }
}

/**
 * Predict passes over `observer` within [startMs, startMs + hours].
 * Coarse 30 s elevation scan; horizon crossings refined by bisection to ≤1 s;
 * max elevation refined by ternary search. Passes peaking below 5° are
 * dropped; at most 50 passes are returned.
 *
 * `noradId` defaults to the satrec's parsed catalog number; the worker passes
 * the authoritative id explicitly.
 */
export function predictPasses(
  satrec: SatRec,
  observer: ObserverGeo,
  startMs: number,
  hours: number,
  noradId: number = Number.parseInt(satrec.satnum, 10) || 0,
): PassPrediction[] {
  const observerGd: GeodeticLocation = {
    latitude: observer.latDeg * DEG_TO_RAD,
    longitude: observer.lonDeg * DEG_TO_RAD,
    height: observer.heightM / 1000, // meters → km
  }

  const elAt = (tMs: number): number =>
    lookAnglesAt(satrec, observerGd, tMs)?.elDeg ?? -90

  /**
   * Bisect a horizon crossing bracketed by el(tBelow) ≤ 0 < el(tAbove).
   * Returns the above-horizon side, so refined AOS/LOS endpoints have el ≥ 0.
   */
  const bisectCrossing = (tBelow: number, tAbove: number): number => {
    let below = tBelow
    let above = tAbove
    while (Math.abs(above - below) > REFINE_TOLERANCE_MS) {
      const mid = (below + above) / 2
      if (elAt(mid) > 0) above = mid
      else below = mid
    }
    return Math.round(above)
  }

  const passes: PassPrediction[] = []

  const finalizePass = (aosMs: number, losMs: number): void => {
    if (losMs - aosMs < REFINE_TOLERANCE_MS) return

    // Elevation over a pass is unimodal — ternary-search the peak to ~1 s.
    let lo = aosMs
    let hi = losMs
    while (hi - lo > REFINE_TOLERANCE_MS) {
      const third = (hi - lo) / 3
      const m1 = lo + third
      const m2 = hi - third
      if (elAt(m1) < elAt(m2)) lo = m1
      else hi = m2
    }
    let maxElMs = Math.round((lo + hi) / 2)
    let maxElDeg = elAt(maxElMs)

    const samples: PassSample[] = []
    const pushSample = (tMs: number): void => {
      const look = lookAnglesAt(satrec, observerGd, tMs)
      if (!look) return
      samples.push({ tMs, azDeg: look.azDeg, elDeg: look.elDeg, rangeKm: look.rangeKm })
      if (look.elDeg > maxElDeg) {
        maxElDeg = look.elDeg
        maxElMs = tMs
      }
    }
    for (let t = aosMs; t < losMs; t += COARSE_STEP_MS) pushSample(t)
    pushSample(losMs)

    if (maxElDeg < MIN_MAX_ELEVATION_DEG) return
    passes.push({ noradId, aosMs, losMs, maxElDeg, maxElMs, samples })
  }

  const endMs = startMs + hours * 3_600_000
  let prevT = startMs
  let inPass = elAt(startMs) > 0
  // A pass already in progress at the window start is clamped to startMs.
  let aosMs = startMs

  for (let t = startMs + COARSE_STEP_MS; prevT < endMs; t += COARSE_STEP_MS) {
    const tc = Math.min(t, endMs)
    const el = elAt(tc)
    if (!inPass && el > 0) {
      aosMs = bisectCrossing(prevT, tc)
      inPass = true
    } else if (inPass && el <= 0) {
      finalizePass(aosMs, bisectCrossing(tc, prevT))
      inPass = false
      if (passes.length >= MAX_PASSES) return passes
    }
    prevT = tc
  }

  // Still above the horizon at the window end: clamp LOS to endMs.
  if (inPass && passes.length < MAX_PASSES) finalizePass(aosMs, endMs)

  return passes
}
