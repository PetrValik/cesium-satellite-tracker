/**
 * Device position for the HUD (LOCATE ME). Browser geolocation stays out of
 * the engine; this wraps the callback API in a Promise that always resolves.
 */
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
