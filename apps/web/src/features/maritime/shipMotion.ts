import type { Ship } from '@orbital-ops/shared'

/**
 * Vessel dead reckoning and bearing — the ONE rule set for the ships layer,
 * the selected-vessel decal and the follow camera, so all three put a ship
 * on the same point. Pure, allocation-free: results go into caller-owned
 * `out` objects.
 */

const KNOTS_TO_MS = 0.514444
/** Metres per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEG = 111_320
const RAD_PER_DEG = Math.PI / 180
/**
 * Below this speed over ground the vessel is treated as moored: it is not
 * dead-reckoned, and its COG (noise below steerageway) is not a bearing.
 */
const MOORED_SOG_KN = 0.2
/**
 * Dead-reckoning horizon: a report older than this is frozen at its
 * 30-minute extrapolation, so a stale vessel does not sail off across the
 * globe.
 */
export const SHIP_MAX_DEAD_RECKON_MS = 30 * 60 * 1000
/**
 * cos(lat) floor for the equirectangular longitude step: keeps the division
 * sane for the (data-error) case of a vessel reported at a pole.
 */
const MIN_COS_LAT = 0.01

/** Equirectangular surface velocity, degrees per second. */
export interface ShipVelocity {
  vLatDegS: number
  vLonDegS: number
}

export interface ShipPosition {
  latDeg: number
  lonDeg: number
}

/**
 * Surface velocity of a report in degrees/second:
 * dLat = v·cos(COG)/111320, dLon = v·sin(COG)/(111320·cos lat).
 * Motion follows COURSE over ground — the true heading is where the bow
 * points, not where the ship goes, and never moves it. Moored → zero.
 */
export function shipVelocity(
  ship: Pick<Ship, 'latDeg' | 'sogKn' | 'cogDeg'>,
  out: ShipVelocity,
): ShipVelocity {
  if (ship.sogKn < MOORED_SOG_KN) {
    out.vLatDegS = 0
    out.vLonDegS = 0
    return out
  }
  const bearingRad = ship.cogDeg * RAD_PER_DEG
  const speedMs = ship.sogKn * KNOTS_TO_MS
  const cosLat = Math.max(Math.cos(ship.latDeg * RAD_PER_DEG), MIN_COS_LAT)
  out.vLatDegS = (speedMs * Math.cos(bearingRad)) / METERS_PER_DEG
  out.vLonDegS = (speedMs * Math.sin(bearingRad)) / (METERS_PER_DEG * cosLat)
  return out
}

/**
 * Seconds to dead-reckon a report taken at `tsMs` to `wallNowMs`, clamped
 * to [0, SHIP_MAX_DEAD_RECKON_MS]: a report stamped in the future (clock
 * skew) never moves a ship backwards.
 */
export function shipDeadReckonSec(tsMs: number, wallNowMs: number): number {
  return Math.min(Math.max(wallNowMs - tsMs, 0), SHIP_MAX_DEAD_RECKON_MS) / 1000
}

const scratchVelocity: ShipVelocity = { vLatDegS: 0, vLonDegS: 0 }

/**
 * The report dead-reckoned to wall-clock `wallNowMs` (constant course and
 * speed, equirectangular step), written into `out` and returned.
 */
export function shipPositionAt(
  ship: Pick<Ship, 'latDeg' | 'lonDeg' | 'sogKn' | 'cogDeg' | 'tsMs'>,
  wallNowMs: number,
  out: ShipPosition,
): ShipPosition {
  const v = shipVelocity(ship, scratchVelocity)
  const dtSec = shipDeadReckonSec(ship.tsMs, wallNowMs)
  out.latDeg = ship.latDeg + v.vLatDegS * dtSec
  out.lonDeg = ship.lonDeg + v.vLonDegS * dtSec
  return out
}

/**
 * Bow bearing for ORIENTATION only, degrees, or null when none is
 * meaningful: AIS true heading first (an anchored ship's bow still points
 * somewhere real), then COG but only above MOORED_SOG_KN.
 */
export function shipBearingDeg(ship: Pick<Ship, 'hdgDeg' | 'sogKn' | 'cogDeg'>): number | null {
  if (ship.hdgDeg !== null) return ship.hdgDeg
  return ship.sogKn >= MOORED_SOG_KN ? ship.cogDeg : null
}
