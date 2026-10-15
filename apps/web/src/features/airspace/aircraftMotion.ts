import type { Aircraft } from '@orbital-ops/shared'

/**
 * Aircraft dead reckoning — the ONE rule set for the aircraft layer, the
 * selected-aircraft decal and the follow camera, so all three put an
 * aircraft on the same point. Pure, allocation-free: results go into
 * caller-owned `out` objects.
 */

/** Metres per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEG = 111_320
const RAD_PER_DEG = Math.PI / 180
/**
 * Dead-reckoning horizon: state vectors older than this are frozen at their
 * 15-minute extrapolation so stale aircraft don't fly off across the globe.
 */
export const AIRCRAFT_MAX_DEAD_RECKON_MS = 15 * 60 * 1000
/**
 * cos(lat) floor for the equirectangular longitude step: keeps the division
 * sane for the (data-error) case of an aircraft reported at a pole.
 */
const MIN_COS_LAT = 0.01

/** Equirectangular velocity: degrees per second, plus climb in m/s. */
export interface AircraftVelocity {
  vLatDegS: number
  vLonDegS: number
  vAltMS: number
}

export interface AircraftPosition {
  latDeg: number
  lonDeg: number
  altM: number
}

/**
 * Velocity of a state vector: dLat = v·cos(track)/111320,
 * dLon = v·sin(track)/(111320·cos lat), climb = vertical rate (null → level).
 * A null ground speed or null track is NOT reckonable: all three components
 * are zero and the aircraft stays exactly at its report — it never drifts
 * along a guessed bearing.
 */
export function aircraftVelocity(
  aircraft: Pick<Aircraft, 'latDeg' | 'velocityMs' | 'trackDeg' | 'verticalRateMs'>,
  out: AircraftVelocity,
): AircraftVelocity {
  if (aircraft.velocityMs === null || aircraft.trackDeg === null) {
    out.vLatDegS = 0
    out.vLonDegS = 0
    out.vAltMS = 0
    return out
  }
  const trackRad = aircraft.trackDeg * RAD_PER_DEG
  const cosLat = Math.max(Math.cos(aircraft.latDeg * RAD_PER_DEG), MIN_COS_LAT)
  out.vLatDegS = (aircraft.velocityMs * Math.cos(trackRad)) / METERS_PER_DEG
  out.vLonDegS = (aircraft.velocityMs * Math.sin(trackRad)) / (METERS_PER_DEG * cosLat)
  out.vAltMS = aircraft.verticalRateMs ?? 0
  return out
}

/**
 * Seconds to dead-reckon a state vector taken at `tsMs` to `wallNowMs`,
 * clamped to [0, AIRCRAFT_MAX_DEAD_RECKON_MS]: a vector stamped in the
 * future (clock skew) never moves an aircraft backwards.
 */
export function aircraftDeadReckonSec(tsMs: number, wallNowMs: number): number {
  return Math.min(Math.max(wallNowMs - tsMs, 0), AIRCRAFT_MAX_DEAD_RECKON_MS) / 1000
}

const scratchVelocity: AircraftVelocity = { vLatDegS: 0, vLonDegS: 0, vAltMS: 0 }

/**
 * The state vector dead-reckoned to wall-clock `wallNowMs`, written into
 * `out` and returned. Altitude starts at the barometric altitude (null → 0)
 * and never goes below 0.
 */
export function aircraftPositionAt(
  aircraft: Pick<
    Aircraft,
    'latDeg' | 'lonDeg' | 'altM' | 'velocityMs' | 'trackDeg' | 'verticalRateMs' | 'tsMs'
  >,
  wallNowMs: number,
  out: AircraftPosition,
): AircraftPosition {
  const v = aircraftVelocity(aircraft, scratchVelocity)
  const dtSec = aircraftDeadReckonSec(aircraft.tsMs, wallNowMs)
  out.latDeg = aircraft.latDeg + v.vLatDegS * dtSec
  out.lonDeg = aircraft.lonDeg + v.vLonDegS * dtSec
  out.altM = Math.max(0, (aircraft.altM ?? 0) + v.vAltMS * dtSec)
  return out
}
