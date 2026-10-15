/**
 * Aircraft photos from the public planespotters.net API (keyless, CORS-open,
 * built for exactly this use — attribution required and rendered by the
 * panel), fetched through the lib/api boundary. Answers are cached per
 * airframe for the session; a cached null means the API answered "no
 * photo", so we don't re-ask. A failed lookup (network error, 429, 5xx,
 * malformed body) is never cached, so a later selection retries.
 */
import { api, ApiError } from '../../lib/api'

export interface PlanePhoto {
  thumbUrl: string
  /** Photo page on planespotters.net (attribution target). */
  link: string
  photographer: string
}

const cache = new Map<string, PlanePhoto | null>()

/** Resolve a photo for an ICAO24 hex; null when none exists or the lookup failed. */
export async function fetchPlanePhoto(icao24: string): Promise<PlanePhoto | null> {
  const cached = cache.get(icao24)
  if (cached !== undefined) return cached
  let result: PlanePhoto | null
  try {
    const photo = await api.planePhoto(icao24)
    result = photo && { ...photo, photographer: photo.photographer ?? 'unknown' }
  } catch (err) {
    // An HTTP or network failure is expected now and then; anything else is
    // planespotters' response shape drifting — say so instead of hiding it.
    if (!(err instanceof ApiError)) console.error('[planePhotos]', err)
    return null
  }
  cache.set(icao24, result)
  return result
}
