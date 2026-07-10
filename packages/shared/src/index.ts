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

export type Satellite = z.infer<typeof SatelliteSchema>
export type GroupInfo = z.infer<typeof GroupInfoSchema>
export type Health = z.infer<typeof HealthSchema>
export type ApiError = z.infer<typeof ApiErrorSchema>
