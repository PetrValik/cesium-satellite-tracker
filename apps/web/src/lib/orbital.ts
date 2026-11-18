/**
 * Pure orbital-mechanics functions shared by the propagation worker and the
 * main thread. Unit and frame discipline:
 *   - satellite.js speaks ECI (TEME) kilometres and km/s; geodetic radians.
 *   - Positions leave this module as ECEF **metres** (`propagateEcef`,
 *     `propagateBatchEcefM`, `rotateEciKmToEcefM`) and angles as **degrees**;
 *     velocity, altitude and range stay km-based. The ECI-km exports are
 *     `sampleOrbitRingEci`, `SatStateEcef.positionEciKm` and
 *     `sunPositionEciKm`. They feed frame-free maths and are never drawn: the
 *     renderer rotates the closed ring by each frame's GMST through
 *     `rotateEciKmToEcefM`, never by hand, and the Earth-shadow test
 *     `isSunlit` compares satellite and Sun in ECI, so no position is ever
 *     converted back from metres.
 *   - Every position goes ECI km → ECEF m through ONE function, `writeEcefM`
 *     (GMST rotation + `KM_TO_M`); callers never scale. The only other km→m
 *     is the scalar altitude inside `footprintRadiusM`.
 * Hot paths reuse a module-scope `Date` and take `out` targets, so a caller
 * can propagate per frame or per tick without allocating on our side
 * (satellite.js still allocates its own result vectors).
 */

import {
  constants,
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  eciToGeodetic,
  ecfToLookAngles,
} from 'satellite.js'
import type { SatRec, GeodeticLocation, EciVec3, PositionAndVelocity } from 'satellite.js'
import type { ObserverGeo, OrbitClass, PassPrediction, PassSample } from './protocol'

const KM_TO_M = 1000
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
/** Mean Earth radius, for the footprint only. Not the SGP4 radius below. */
const EARTH_RADIUS_M = 6_371_000
/** SGP4's own (WGS-72) equatorial radius, 6378.135 km: perigee/apogee and the shadow cylinder. */
const EARTH_EQUATORIAL_RADIUS_KM = constants.earthRadius
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
/** Julian date of the Unix epoch (1970-01-01T00:00Z). */
const JD_UNIX_EPOCH = 2_440_587.5

/** Coarse elevation-scan step for pass prediction. */
const COARSE_STEP_MS = 30_000
/** AOS/LOS bisection tolerance. */
const REFINE_TOLERANCE_MS = 1_000
/** Passes peaking below this elevation are discarded. */
export const MIN_MAX_ELEVATION_DEG = 5
/** A pass is naked-eye only while the observer's Sun is below this elevation (end of civil twilight). */
export const NAKED_EYE_SUN_MAX_ELEVATION_DEG = -6
/** Safety cap on the number of predicted passes per request. */
const MAX_PASSES = 50

/**
 * The instant handed to `propagate`/`gstime`, re-set with `setTime` before
 * every use so no hot path allocates a Date. Safe because every use is
 * synchronous and none calls another user while holding it.
 */
const scratchDate = new Date(0)
/** One converted point, for writers whose target is not an indexable buffer. */
const scratchEcefM: [number, number, number] = [0, 0, 0]

export interface SatStateEcef {
  /** ECEF position [x, y, z], meters. */
  positionEcefM: [number, number, number]
  /**
   * ECI (TEME) position, km, at the same instant: the SGP4 vector as returned,
   * for frame-free maths (the Earth-shadow test). Never drawn.
   */
  positionEciKm: Vec3Like
  /** Speed (magnitude of ECI velocity), km/s. */
  velocityKmS: number
  latDeg: number
  lonDeg: number
  altKm: number
  /** GMST (radians) at the propagated instant — the ECI→ECEF rotation angle. */
  gmstRad: number
}

/** Mutable x/y/z — Cesium's `Cartesian3` satisfies it structurally. */
export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Indexable numeric target: a tuple, `number[]`, `Float32Array` or `Float64Array`. */
type NumericBuffer = { [index: number]: number }

/** A zeroed state to pass as `out` to `propagateEcef` and reuse across calls. */
export function createSatStateEcef(): SatStateEcef {
  return {
    positionEcefM: [0, 0, 0],
    positionEciKm: { x: 0, y: 0, z: 0 },
    velocityKmS: 0,
    latDeg: 0,
    lonDeg: 0,
    altKm: 0,
    gmstRad: 0,
  }
}

function isFiniteVec(v: EciVec3<number>): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

/**
 * THE position conversion: ECI (TEME) km → ECEF m. A rotation about +Z by
 * GMST — term for term the expression satellite.js `eciToEcf` evaluates
 * (pinned bit-exact against it in orbital.test.ts) — then the km→m scale.
 * Writes x, y, z to out[o], out[o + 1], out[o + 2].
 */
function writeEcefM(
  xKm: number,
  yKm: number,
  zKm: number,
  cosGmst: number,
  sinGmst: number,
  out: NumericBuffer,
  o: number,
): void {
  out[o] = (xKm * cosGmst + yKm * sinGmst) * KM_TO_M
  out[o + 1] = (xKm * -sinGmst + yKm * cosGmst) * KM_TO_M
  out[o + 2] = zKm * KM_TO_M
}

/** SGP4 at `date` (ECI km, km/s); null on failure or a non-finite vector. */
function propagateEci(satrec: SatRec, date: Date): PositionAndVelocity | null {
  const pv = propagate(satrec, date)
  if (!pv || !isFiniteVec(pv.position) || !isFiniteVec(pv.velocity)) return null
  return pv
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

/** Perigee and apogee heights, km above the equatorial radius. */
export interface PerigeeApogee {
  perigeeKm: number
  apogeeKm: number
}

/**
 * Perigee / apogee from the mean elements: a·(1 ∓ e) − R, in km, where a is
 * `satrec.a` (Earth radii, set by `sgp4init`) scaled by R = 6378.135 km, SGP4's
 * equatorial radius. That is the published convention (height above the
 * equator's radius), so for an inclined orbit it reads lower than the geodetic
 * altitude NOW shows — `altitudeSpanKm` is that one.
 */
export function perigeeApogeeKm(satrec: SatRec): PerigeeApogee {
  const R = EARTH_EQUATORIAL_RADIUS_KM
  const aKm = satrec.a * R
  const e = satrec.ecco
  return { perigeeKm: aKm * (1 - e) - R, apogeeKm: aKm * (1 + e) - R }
}

/** Coarse samples per orbit for `altitudeSpanKm` (never closer than a minute apart). */
const SPAN_SAMPLES_PER_ORBIT = 360
/** Ternary-search steps per extreme: shrinks a 2-step bracket by (2/3)^24 ≈ 6e-5. */
const SPAN_REFINE_STEPS = 24

/** `altitudeSpanKm`'s coarse step: every minute, but never more than 360 samples an orbit. */
export function altitudeSpanStepMs(periodMinutes: number): number {
  return Math.max(MS_PER_MINUTE, (periodMinutes * MS_PER_MINUTE) / SPAN_SAMPLES_PER_ORBIT)
}

/**
 * Lowest and highest geodetic altitude (km above the WGS-84 ellipsoid, the
 * `altKm` NOW shows) over one SGP4 orbit from `startMs`, so the live value
 * always lies inside the span. A coarse sweep (`altitudeSpanStepMs`, ≤ 361
 * samples) finds each extreme, then a ternary search inside its ±1 step
 * bracket pins it: ≤ ~460 SGP4 calls whatever the period (a 60 s sweep of a
 * 13.7-day orbit was ~20 000). Failed samples are skipped; with none left
 * both are NaN. Call it once per selection and at most once per 12 sim-hours
 * after that (the tracking slice's ~5 Hz push re-sweeps it), never per frame.
 */
export function altitudeSpanKm(satrec: SatRec, startMs: number): { lowKm: number; highKm: number } {
  const stepMs = altitudeSpanStepMs(orbitalPeriodMinutes(satrec))
  const steps = Math.ceil((orbitalPeriodMinutes(satrec) * MS_PER_MINUTE) / stepMs)
  const endMs = startMs + steps * stepMs
  const state = createSatStateEcef()
  const altAt = (ms: number) => (propagateEcef(satrec, ms, state) ? state.altKm : Number.NaN)
  let lowKm = Infinity
  let highKm = -Infinity
  let lowMs = startMs
  let highMs = startMs
  for (let k = 0; k <= steps; k++) {
    const ms = startMs + k * stepMs
    const alt = altAt(ms)
    if (Number.isNaN(alt)) continue
    if (alt < lowKm) [lowKm, lowMs] = [alt, ms]
    if (alt > highKm) [highKm, highMs] = [alt, ms]
  }
  if (lowKm > highKm) return { lowKm: Number.NaN, highKm: Number.NaN }
  // sign 1 refines a maximum, −1 a minimum; never worse than the coarse value.
  const refine = (centreMs: number, sign: 1 | -1, coarseKm: number) => {
    let lo = Math.max(startMs, centreMs - stepMs)
    let hi = Math.min(endMs, centreMs + stepMs)
    for (let i = 0; i < SPAN_REFINE_STEPS; i++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      const a1 = altAt(m1)
      const a2 = altAt(m2)
      if (Number.isNaN(a1) || Number.isNaN(a2)) break
      if (sign * a1 < sign * a2) lo = m1
      else hi = m2
    }
    const best = altAt((lo + hi) / 2)
    return Number.isNaN(best) ? coarseKm : sign > 0 ? Math.max(best, coarseKm) : Math.min(best, coarseKm)
  }
  return { lowKm: refine(lowMs, -1, lowKm), highKm: refine(highMs, 1, highKm) }
}

/** TLE epoch (line 1 cols 19-32) as Unix ms, UTC, from the parsed `satrec.jdsatepoch`. */
export function tleEpochMs(satrec: SatRec): number {
  return (satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY
}

export interface IntlDesignator {
  /** Four-digit launch year. */
  launchYear: number
  /** COSPAR form, e.g. '1998-067A'. */
  designator: string
}

const INTL_DESIGNATOR_RE = /^(\d{2})(\d{3})([A-Z]{1,3})$/

/**
 * International designator from TLE line 1 cols 10-17 (`98067A` → 1998,
 * '1998-067A'). Two-digit years 57–99 are 19xx and 00–56 are 20xx (Sputnik
 * launched in 1957). Null for a blank, garbled or truncated field.
 */
export function internationalDesignator(tle1: string): IntlDesignator | null {
  const match = INTL_DESIGNATOR_RE.exec(tle1.slice(9, 17).trimEnd())
  if (!match) return null
  const yy = Number(match[1])
  const launchYear = yy >= 57 ? 1900 + yy : 2000 + yy
  return { launchYear, designator: `${launchYear}-${match[2]}${match[3]}` }
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
 * geodetic degrees. GMST is computed for the same instant as the propagation
 * and returned as `gmstRad`, so a caller never recomputes it. Returns null
 * when SGP4 fails or produces non-finite output (`out` is then untouched).
 *
 * Pass `out` (from `createSatStateEcef`) on a per-frame path: it is filled in
 * place and returned, and nothing is allocated on our side. Without `out` a
 * fresh object is returned.
 */
export function propagateEcef(
  satrec: SatRec,
  epochMs: number,
  out?: SatStateEcef,
): SatStateEcef | null {
  scratchDate.setTime(epochMs)
  const pv = propagateEci(satrec, scratchDate)
  if (!pv) return null

  const gmstRad = gstime(scratchDate)
  const geo = eciToGeodetic(pv.position, gmstRad)
  const latDeg = geo.latitude * RAD_TO_DEG
  const lonDeg = geo.longitude * RAD_TO_DEG
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg) || !Number.isFinite(geo.height)) {
    return null
  }

  const state = out ?? createSatStateEcef()
  const p = pv.position
  writeEcefM(p.x, p.y, p.z, Math.cos(gmstRad), Math.sin(gmstRad), state.positionEcefM, 0)
  state.positionEciKm.x = p.x
  state.positionEciKm.y = p.y
  state.positionEciKm.z = p.z
  state.velocityKmS = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z)
  state.latDeg = latDeg
  state.lonDeg = lonDeg
  state.altKm = geo.height
  state.gmstRad = gmstRad
  return state
}

/**
 * Propagate a whole working set to ONE instant, writing ECEF meters into
 * `out` at [3i, 3i + 1, 3i + 2]; `out.length` must be at least
 * 3 · satrecs.length. One Date and one GMST serve the batch — every
 * satellite shares the instant — and nothing is allocated on our side.
 *
 * A null satrec (TLE failed to parse) or a failed propagation writes a NaN
 * triple: the slot is kept, never dropped, so every later index stays
 * aligned. A bad satellite never throws; the return value is how many slots
 * failed.
 */
export function propagateBatchEcefM(
  satrecs: readonly (SatRec | null)[],
  epochMs: number,
  out: Float32Array | Float64Array,
): number {
  scratchDate.setTime(epochMs)
  const gmstRad = gstime(scratchDate)
  const cosGmst = Math.cos(gmstRad)
  const sinGmst = Math.sin(gmstRad)
  let failed = 0
  for (let i = 0, o = 0; i < satrecs.length; i++, o += 3) {
    const satrec = satrecs[i]
    const pv = satrec ? propagateEci(satrec, scratchDate) : null
    if (pv) {
      writeEcefM(pv.position.x, pv.position.y, pv.position.z, cosGmst, sinGmst, out, o)
    } else {
      out[o] = Number.NaN
      out[o + 1] = Number.NaN
      out[o + 2] = Number.NaN
      failed++
    }
  }
  return failed
}

export interface OrbitRing {
  /** ECI (TEME) kilometers, [x0,y0,z0, ...]; last sample repeats the first. */
  eciKm: Float64Array
  periodMinutes: number
}

/**
 * Sample one full revolution in the inertial (ECI) frame starting at
 * `epochMs` — the instantaneous orbit as a closed curve (the final sample
 * duplicates the first to close the loop). It stays in ECI kilometers on
 * purpose: the renderer rotates the whole ring by the current GMST each frame
 * (`rotateEciKmToEcefM`), so the ring turns with the sky, not the ground.
 * If every propagation fails the array is NaN-filled.
 */
export function sampleOrbitRingEci(
  satrec: SatRec,
  epochMs: number,
  samples = 180,
): OrbitRing {
  const n = Math.max(8, Math.floor(samples))
  const periodMinutes = orbitalPeriodMinutes(satrec)
  const periodMs = periodMinutes * MS_PER_MINUTE
  const eciKm = new Float64Array(3 * (n + 1))

  let lastGood = -1
  const pendingBackfill: number[] = []
  const copySample = (from: number, to: number): void => {
    eciKm[3 * to] = eciKm[3 * from]
    eciKm[3 * to + 1] = eciKm[3 * from + 1]
    eciKm[3 * to + 2] = eciKm[3 * from + 2]
  }

  for (let i = 0; i < n; i++) {
    scratchDate.setTime(epochMs + (periodMs * i) / n)
    const pv = propagate(satrec, scratchDate)
    if (pv && isFiniteVec(pv.position)) {
      eciKm[3 * i] = pv.position.x
      eciKm[3 * i + 1] = pv.position.y
      eciKm[3 * i + 2] = pv.position.z
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
    eciKm.fill(Number.NaN)
  } else {
    copySample(0, n) // close the loop
  }

  return { eciKm, periodMinutes }
}

/**
 * Rotate an ECI-km ring (from `sampleOrbitRingEci`) into ECEF meters for one
 * GMST, writing point j into `out[j]` in place. Writes
 * min(out.length, eciKm.length / 3) points and allocates nothing — the
 * renderer calls it whenever GMST moved.
 */
export function rotateEciKmToEcefM(
  eciKm: ArrayLike<number>,
  gmstRad: number,
  out: readonly Vec3Like[],
): void {
  const cosGmst = Math.cos(gmstRad)
  const sinGmst = Math.sin(gmstRad)
  const n = Math.min(out.length, Math.floor(eciKm.length / 3))
  for (let j = 0, i = 0; j < n; j++, i += 3) {
    writeEcefM(eciKm[i], eciKm[i + 1], eciKm[i + 2], cosGmst, sinGmst, scratchEcefM, 0)
    const point = out[j]
    point.x = scratchEcefM[0]
    point.y = scratchEcefM[1]
    point.z = scratchEcefM[2]
  }
}

/**
 * Great-circle radius (meters) of the ground area from which the satellite is
 * above the geometric horizon: R * acos(R / (R + alt)).
 */
export function footprintRadiusM(altKm: number): number {
  if (!Number.isFinite(altKm) || altKm <= 0) return 0
  return EARTH_RADIUS_M * Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + altKm * KM_TO_M))
}

/** One astronomical unit, km. */
const AU_KM = 149_597_870.7
/** The Sun's ECI km position for `sunElevationDeg` and `predictPasses`; re-filled before every use. */
const scratchSunEciKm: Vec3Like = { x: 0, y: 0, z: 0 }

/**
 * The Sun's geocentric position at `epochMs`, ECI km, written into `out` and
 * returned; allocates nothing. Do NOT swap in satellite.js `sunPos`: 6.0.2
 * applies deg2rad to the mean anomaly's rate term only, which leaves it ~1.4°
 * off. Agrees with Cesium's Sun to 0.36–0.37°, the J2000→date precession
 * Cesium's no-EOP frame leaves out (orbital.crosscheck.test.ts).
 */
export function sunPositionEciKm(epochMs: number, out: Vec3Like): Vec3Like {
  // Vallado low-precision Sun, the series satellite.js 6.0.2 `sunPos` uses, with the mean anomaly
  // converted as a whole (sunPos applies deg2rad to the rate term only: ~1° error). Mean equator and
  // equinox of date, which matches TEME to < 0.01°; UTC is used for TT (69 s, < 0.001°).
  const t = (epochMs / MS_PER_DAY + JD_UNIX_EPOCH - 2_451_545) / 36_525
  const meanLongDeg = (280.46 + 36_000.77 * t) % 360
  const m = ((357.5277233 + 35_999.05034 * t) * DEG_TO_RAD) % (2 * Math.PI)
  const eclLon = (meanLongDeg + 1.914666471 * Math.sin(m) + 0.019994643 * Math.sin(2 * m)) * DEG_TO_RAD
  const obliquity = (23.439291 - 0.0130042 * t) * DEG_TO_RAD
  const rKm = (1.000140612 - 0.016708617 * Math.cos(m) - 0.000139589 * Math.cos(2 * m)) * AU_KM
  out.x = rKm * Math.cos(eclLon)
  out.y = rKm * Math.cos(obliquity) * Math.sin(eclLon)
  out.z = rKm * Math.sin(obliquity) * Math.sin(eclLon)
  return out
}

/**
 * Earth-shadow test, cylindrical umbra: false when `sat` is behind the Earth
 * (a sphere of SGP4's R = 6378.135 km) and inside the cylinder it casts away
 * from the Sun. Both vectors must share one frame (ECI km) and one instant;
 * only the Sun's direction is used (a point at infinity). No penumbra: its
 * edge moves the flag by ~8 s for the ISS. One dot product, no allocation.
 */
export function isSunlit(sat: Readonly<Vec3Like>, sun: Readonly<Vec3Like>): boolean {
  const along = (sat.x * sun.x + sat.y * sun.y + sat.z * sun.z) / Math.hypot(sun.x, sun.y, sun.z)
  if (along >= 0) return true // day side of the terminator plane
  const R = EARTH_EQUATORIAL_RADIUS_KM
  return sat.x * sat.x + sat.y * sat.y + sat.z * sat.z - along * along > R * R // outside the shadow cylinder
}

/** An observer as satellite.js wants it: geodetic radians and height in km. */
function toObserverGd(observer: ObserverGeo): GeodeticLocation {
  return {
    latitude: observer.latDeg * DEG_TO_RAD,
    longitude: observer.lonDeg * DEG_TO_RAD,
    height: observer.heightM / KM_TO_M, // satellite.js wants the observer height in km
  }
}

/**
 * Geometric elevation (degrees, no refraction) of the Sun already written into
 * `sunEciKm` for `epochMs`, seen from `observerGd` (radians, km). The same
 * path as the pass look angles: GMST of that instant → ECEF → look angles.
 */
function sunElevationFromDeg(
  observerGd: GeodeticLocation,
  sunEciKm: Readonly<Vec3Like>,
  epochMs: number,
): number {
  const gmst = gstime(epochMs / MS_PER_DAY + JD_UNIX_EPOCH)
  return ecfToLookAngles(observerGd, eciToEcf(sunEciKm, gmst)).elevation * RAD_TO_DEG
}

/** The Sun's geometric elevation over `observer` at `epochMs`, degrees (no refraction). */
export function sunElevationDeg(observer: ObserverGeo, epochMs: number): number {
  return sunElevationFromDeg(toObserverGd(observer), sunPositionEciKm(epochMs, scratchSunEciKm), epochMs)
}

interface LookSample {
  azDeg: number
  elDeg: number
  rangeKm: number
  /** SGP4's ECI km position at the same instant (its own result object, not copied). */
  eciKm: EciVec3<number>
}

/** Look angles at one instant; null when propagation fails. */
function lookAnglesAt(
  satrec: SatRec,
  observerGd: GeodeticLocation,
  tMs: number,
): LookSample | null {
  scratchDate.setTime(tMs)
  const pv = propagate(satrec, scratchDate)
  if (!pv || !isFiniteVec(pv.position)) return null
  const gmst = gstime(scratchDate)
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
  return { azDeg, elDeg, rangeKm: look.rangeSat, eciKm: pv.position }
}

/**
 * Predict passes over `observer` within [startMs, startMs + hours].
 * Coarse 30 s elevation scan; horizon crossings refined by bisection to ≤1 s;
 * max elevation refined by ternary search. Passes peaking below 5° are
 * dropped; at most 50 passes are returned.
 *
 * Each pass also carries its rise / set azimuth (first / last sample at or
 * above the horizon) and `nakedEye`: some such sample has the satellite out of
 * the Earth's shadow (`isSunlit`) while the observer's Sun is below
 * `NAKED_EYE_SUN_MAX_ELEVATION_DEG`. Both are decided on the ~30 s samples.
 *
 * `noradId` defaults to the satrec's parsed catalog number; a caller holding
 * the authoritative catalog id may pass it explicitly.
 */
export function predictPasses(
  satrec: SatRec,
  observer: ObserverGeo,
  startMs: number,
  hours: number,
  noradId: number = Number.parseInt(satrec.satnum, 10) || 0,
): PassPrediction[] {
  const observerGd = toObserverGd(observer)

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
    let nakedEye = false
    const pushSample = (tMs: number): void => {
      const look = lookAnglesAt(satrec, observerGd, tMs)
      if (!look) return
      samples.push({ tMs, azDeg: look.azDeg, elDeg: look.elDeg, rangeKm: look.rangeKm })
      if (look.elDeg > maxElDeg) {
        maxElDeg = look.elDeg
        maxElMs = tMs
      }
      if (!nakedEye && look.elDeg >= 0) {
        // The sky test first: a daylight sample needs no shadow test. Sun and
        // satellite are both ECI km of this instant.
        sunPositionEciKm(tMs, scratchSunEciKm)
        nakedEye =
          sunElevationFromDeg(observerGd, scratchSunEciKm, tMs) < NAKED_EYE_SUN_MAX_ELEVATION_DEG &&
          isSunlit(look.eciKm, scratchSunEciKm)
      }
    }
    for (let t = aosMs; t < losMs; t += COARSE_STEP_MS) pushSample(t)
    pushSample(losMs)

    if (maxElDeg < MIN_MAX_ELEVATION_DEG) return

    let riseAzDeg = Number.NaN
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].elDeg >= 0) {
        riseAzDeg = samples[i].azDeg
        break
      }
    }
    let setAzDeg = Number.NaN
    for (let i = samples.length - 1; i >= 0; i--) {
      if (samples[i].elDeg >= 0) {
        setAzDeg = samples[i].azDeg
        break
      }
    }
    passes.push({ noradId, aosMs, losMs, maxElDeg, maxElMs, samples, riseAzDeg, setAzDeg, nakedEye })
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
