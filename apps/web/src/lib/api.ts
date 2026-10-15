/**
 * Typed API client — the web app's one network boundary. Every response is
 * parsed before it is returned (the shared zod contract for our API, a
 * hand-written validator for planespotters.net), so a drifting shape fails
 * loudly here instead of deep in the UI. ApiError.status is null for
 * network failures and the HTTP status otherwise (503 = feed not
 * configured — stores use this to back off).
 */
import {
  AircraftListSchema,
  GroupListSchema,
  SatelliteListSchema,
  ShipListSchema,
  type Aircraft,
  type GroupInfo,
  type Satellite,
  type Ship,
} from '@orbital-ops/shared'

export class ApiError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface Parser<T> {
  parse(value: unknown): T
}

async function getJson<T>(url: string, schema: Parser<T>): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new ApiError(`${url} unreachable`, null)
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(detail, res.status)
  }
  return schema.parse(await res.json())
}

const get = <T>(path: string, schema: Parser<T>): Promise<T> => getJson(`/api${path}`, schema)

/** The first planespotters.net photo listed for an airframe. */
export interface PlanespottersPhoto {
  thumbUrl: string
  /** Photo page on planespotters.net (the attribution target). */
  link: string
  photographer: string | null
}

const PLANESPOTTERS_HEX_URL = 'https://api.planespotters.net/pub/photos/hex/'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const srcOf = (thumb: unknown): string | undefined =>
  isRecord(thumb) && typeof thumb.src === 'string' && thumb.src !== '' ? thumb.src : undefined

/**
 * Validates the part of planespotters' `/pub/photos/hex/{icao24}` response
 * the panel reads. A body without a `photos` array is drift and throws; an
 * empty list, or a first photo lacking a thumbnail or link, is "no photo".
 */
const PlanespottersSchema: Parser<PlanespottersPhoto | null> = {
  parse(value) {
    if (!isRecord(value) || !Array.isArray(value.photos)) {
      throw new TypeError('planespotters: response has no photos array')
    }
    const photo: unknown = value.photos[0]
    if (!isRecord(photo)) return null
    const thumbUrl = srcOf(photo.thumbnail_large) ?? srcOf(photo.thumbnail)
    const link = typeof photo.link === 'string' && photo.link !== '' ? photo.link : undefined
    if (thumbUrl === undefined || link === undefined) return null
    const photographer = typeof photo.photographer === 'string' ? photo.photographer : null
    return { thumbUrl, link, photographer }
  },
}

export const api = {
  groups: (): Promise<GroupInfo[]> => get('/groups', GroupListSchema),
  satellites: (group: string): Promise<Satellite[]> =>
    get(`/satellites?group=${encodeURIComponent(group)}`, SatelliteListSchema),
  search: (q: string): Promise<Satellite[]> =>
    get(`/satellites/search?q=${encodeURIComponent(q)}`, SatelliteListSchema),
  ships: (): Promise<Ship[]> => get('/ships', ShipListSchema),
  aircraft: (): Promise<Aircraft[]> => get('/aircraft', AircraftListSchema),
  /** Airframe photo from planespotters.net (keyless, CORS-open); null = none listed. */
  planePhoto: (icao24: string): Promise<PlanespottersPhoto | null> =>
    getJson(`${PLANESPOTTERS_HEX_URL}${encodeURIComponent(icao24)}`, PlanespottersSchema),
}
