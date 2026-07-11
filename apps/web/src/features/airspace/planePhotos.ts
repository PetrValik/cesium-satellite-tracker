/**
 * Aircraft photos from the public planespotters.net API (keyless, CORS-open,
 * built for exactly this use — attribution required and rendered by the
 * panel). Results are cached per airframe for the session; null = the API
 * answered "no photo", so we don't re-ask.
 */

export interface PlanePhoto {
  thumbUrl: string
  /** Photo page on planespotters.net (attribution target). */
  link: string
  photographer: string
}

const cache = new Map<string, PlanePhoto | null>()

interface PlanespottersResponse {
  photos?: {
    thumbnail_large?: { src?: string }
    thumbnail?: { src?: string }
    link?: string
    photographer?: string
  }[]
}

/** Resolve a photo for an ICAO24 hex; null when none exists. */
export async function fetchPlanePhoto(icao24: string): Promise<PlanePhoto | null> {
  const cached = cache.get(icao24)
  if (cached !== undefined) return cached
  let result: PlanePhoto | null = null
  try {
    const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(icao24)}`)
    if (res.ok) {
      const data = (await res.json()) as PlanespottersResponse
      const photo = data.photos?.[0]
      const thumbUrl = photo?.thumbnail_large?.src ?? photo?.thumbnail?.src
      if (photo && thumbUrl && photo.link) {
        result = { thumbUrl, link: photo.link, photographer: photo.photographer ?? 'unknown' }
      }
    }
  } catch {
    // network failure — treat as "no photo" but do not cache, so a later
    // selection retries
    return null
  }
  cache.set(icao24, result)
  return result
}
