/**
 * Guards for untrusted upstream payloads, shared by the live-feed slices.
 * Both feeds parse loosely typed JSON (AIS envelopes, OpenSky state vectors),
 * so every field is verified here before it reaches a shared contract.
 */

/** A finite number, or undefined for anything else (null, NaN, strings, …). */
export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Both coordinates when present and inside WGS84 degree bounds, else undefined. */
export function validLatLon(
  lat: number | undefined,
  lon: number | undefined,
): { lat: number; lon: number } | undefined {
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return undefined
  }
  return { lat, lon }
}
