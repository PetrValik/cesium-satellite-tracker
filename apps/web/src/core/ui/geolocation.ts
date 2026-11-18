/**
 * Device position for the HUD (LOCATE ME). Browser geolocation stays out of
 * the engine; this wraps the callback API in a Promise that always resolves.
 */
import type { CameraCommand } from './cameraStore'

export type LocateError = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

export type LocateResult =
  | { ok: true; latDeg: number; lonDeg: number; altitudeM: number | null }
  | { ok: false; error: LocateError }

export type GeoSource = Pick<Geolocation, 'getCurrentPosition'>

/** A coarse fix is enough for a 500 km view, and a recent one may be reused. */
export const LOCATE_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 300_000,
}

/**
 * Ask for the device position. Callers pass
 * `'geolocation' in navigator ? navigator.geolocation : undefined`.
 * Error codes are numeric because the GeolocationPositionError constants
 * do not exist outside a browser.
 */
export function locateDevice(geo: GeoSource | undefined): Promise<LocateResult> {
  if (!geo) return Promise.resolve({ ok: false, error: 'unsupported' })
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          latDeg: pos.coords.latitude,
          lonDeg: pos.coords.longitude,
          altitudeM: pos.coords.altitude,
        }),
      (err) =>
        resolve({
          ok: false,
          error: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable',
        }),
      LOCATE_OPTIONS,
    )
  })
}

const LOCATE_ERROR_LABELS: Record<LocateError, string> = {
  denied: 'LOCATION DENIED',
  unavailable: 'LOCATION UNAVAILABLE',
  timeout: 'LOCATION TIMED OUT',
  unsupported: 'NO LOCATION IN THIS BROWSER',
}

/** The short HUD message shown beside the LOCATE button. */
export function locateErrorLabel(e: LocateError): string {
  return LOCATE_ERROR_LABELS[e]
}

/** LOCATE flies to this height above the device: a regional view. */
export const LOCATE_HEIGHT_M = 500_000
/** A fix arriving later than this after the tap no longer flies. */
export const LOCATE_MAX_AGE_MS = 15_000

/** A fix that came too late to act on: not an error, so the HUD shows nothing. */
export type LocateOutcome = LocateResult | { ok: false; error: 'stale' }

export interface LocateFlight {
  /** Sends the flyTo (requestCamera). */
  request: (command: CameraCommand) => void
  /** The camera request counter (cameraRequestSeq). */
  seq: () => number
  /** Whether the follow lock is on. */
  following: () => boolean
  /** A monotonic clock in ms (performance.now). */
  nowMs: () => number
  heightM: number
  maxAgeMs?: number
}

/**
 * LOCATE ME: ask for the device position and fly there, but only while the
 * tap is still the user's latest camera intent. A permission prompt can stay
 * open indefinitely; if meanwhile another camera command was requested, the
 * follow lock changed (picking a ship engages it), or more than `maxAgeMs`
 * passed, the fix resolves as `stale` and nothing flies. Errors are returned
 * as they come, stale or not.
 */
export async function locateAndFly(geo: GeoSource | undefined, flight: LocateFlight): Promise<LocateOutcome> {
  const seqAtTap = flight.seq()
  const followingAtTap = flight.following()
  const tapMs = flight.nowMs()
  const result = await locateDevice(geo)
  if (!result.ok) return result
  if (
    flight.seq() !== seqAtTap ||
    flight.following() !== followingAtTap ||
    flight.nowMs() - tapMs > (flight.maxAgeMs ?? LOCATE_MAX_AGE_MS)
  ) {
    return { ok: false, error: 'stale' }
  }
  flight.request({ kind: 'flyTo', lonDeg: result.lonDeg, latDeg: result.latDeg, heightM: flight.heightM })
  return result
}
