import { describe, expect, it } from 'vitest'
import {
  GroupInfoSchema,
  HealthSchema,
  SatelliteSchema,
} from '../src/index.ts'

const ISS_TLE1 =
  '1 25544U 98067A   26010.50000000  .00016717  00000+0  30306-3 0  9999'
const ISS_TLE2 =
  '2 25544  51.6400 208.9163 0006317  69.9862 290.2553 15.49560538473472'

describe('SatelliteSchema', () => {
  it('round-trips a valid satellite', () => {
    const sat = {
      noradId: 25544,
      name: 'ISS (ZARYA)',
      tle1: ISS_TLE1,
      tle2: ISS_TLE2,
      groups: ['stations'],
    }
    expect(SatelliteSchema.parse(sat)).toEqual(sat)
  })

  it('rejects TLE lines that are not 69 characters', () => {
    const result = SatelliteSchema.safeParse({
      noradId: 25544,
      name: 'ISS (ZARYA)',
      tle1: 'garbage',
      tle2: ISS_TLE2,
      groups: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a negative NORAD id', () => {
    const result = SatelliteSchema.safeParse({
      noradId: -1,
      name: 'X',
      tle1: ISS_TLE1,
      tle2: ISS_TLE2,
      groups: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('GroupInfoSchema', () => {
  it('accepts a fresh group and a never-refreshed group', () => {
    expect(
      GroupInfoSchema.parse({
        slug: 'stations',
        name: 'Space stations',
        count: 12,
        updatedAt: '2026-07-10T12:00:00.000Z',
        stale: false,
      }).stale,
    ).toBe(false)
    expect(
      GroupInfoSchema.parse({
        slug: 'starlink',
        name: 'Starlink',
        count: 0,
        updatedAt: null,
        stale: true,
      }).updatedAt,
    ).toBeNull()
  })
})

describe('HealthSchema', () => {
  it('round-trips', () => {
    const health = { ok: true, satCount: 9500, groups: 8 }
    expect(HealthSchema.parse(health)).toEqual(health)
  })
})
