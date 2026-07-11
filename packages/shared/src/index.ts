import { z } from 'zod'

/** One catalog entry: NORAD id, display name, and the two TLE lines. */
export const SatelliteSchema = z.object({
  noradId: z.number().int().nonnegative(),
  name: z.string().min(1),
  tle1: z.string().length(69),
  tle2: z.string().length(69),
  groups: z.array(z.string()),
})

export const SatelliteListSchema = z.array(SatelliteSchema)

/** A curated CelesTrak group as served by the cache. */
export const GroupInfoSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  count: z.number().int().nonnegative(),
  /** ISO timestamp of the last successful refresh (seed timestamp before first fetch). */
  updatedAt: z.string().nullable(),
  /** True when the data is older than the TTL and the last refresh attempt failed. */
  stale: z.boolean(),
})

export const GroupListSchema = z.array(GroupInfoSchema)

export const HealthSchema = z.object({
  ok: z.boolean(),
  satCount: z.number().int().nonnegative(),
  groups: z.number().int().nonnegative(),
})

export const ApiErrorSchema = z.object({
  error: z.string(),
})

/** Coarse vessel category derived from the AIS ship-type code. */
export const SHIP_TYPES = [
  'cargo',
  'tanker',
  'passenger',
  'fishing',
  'highspeed',
  'military',
  'other',
] as const
export const ShipTypeSchema = z.enum(SHIP_TYPES)

/** One vessel's latest AIS position report. */
export const ShipSchema = z.object({
  mmsi: z.number().int().nonnegative(),
  name: z.string(),
  latDeg: z.number().min(-90).max(90),
  lonDeg: z.number().min(-180).max(180),
  /** Speed over ground, knots. */
  sogKn: z.number(),
  /** Course over ground, degrees. */
  cogDeg: z.number(),
  shipType: ShipTypeSchema,
  /** Epoch ms of the last received report. */
  tsMs: z.number(),
})

export const ShipListSchema = z.array(ShipSchema)

/** One aircraft state vector (OpenSky-style). */
export const AircraftSchema = z.object({
  icao24: z.string().min(1),
  callsign: z.string(),
  latDeg: z.number().min(-90).max(90),
  lonDeg: z.number().min(-180).max(180),
  /** Barometric altitude, meters; null on ground/unknown. */
  altM: z.number().nullable(),
  /** Ground speed, m/s. */
  velocityMs: z.number().nullable(),
  /** True track, degrees. */
  trackDeg: z.number().nullable(),
  verticalRateMs: z.number().nullable(),
  onGround: z.boolean(),
  /** Epoch ms of the state vector. */
  tsMs: z.number(),
})

export const AircraftListSchema = z.array(AircraftSchema)

/** Health of the live (non-satellite) feeds. */
export const LiveStatusSchema = z.object({
  ais: z.object({
    configured: z.boolean(),
    connected: z.boolean(),
    ships: z.number().int().nonnegative(),
  }),
  adsb: z.object({
    configured: z.boolean(),
    aircraft: z.number().int().nonnegative(),
    /** Epoch ms of the last successful poll; null before the first. */
    lastPollMs: z.number().nullable(),
  }),
})

export type Satellite = z.infer<typeof SatelliteSchema>
export type GroupInfo = z.infer<typeof GroupInfoSchema>
export type Health = z.infer<typeof HealthSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
export type ShipType = z.infer<typeof ShipTypeSchema>
export type Ship = z.infer<typeof ShipSchema>
export type Aircraft = z.infer<typeof AircraftSchema>
export type LiveStatus = z.infer<typeof LiveStatusSchema>
