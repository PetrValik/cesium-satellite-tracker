import { describe, expect, it } from 'vitest'
import {
  formatAge,
  formatCount,
  formatDuration,
  formatLatLon,
  formatRate,
  formatUtc,
} from './format'

describe('format helpers', () => {
  it('formatUtc renders zero-padded UTC', () => {
    expect(formatUtc(Date.UTC(2026, 6, 10, 8, 4, 3))).toBe('2026-07-10 08:04:03')
  })

  it('formatCount groups thousands with thin spaces', () => {
    expect(formatCount(12408)).toBe('12 408')
    expect(formatCount(950)).toBe('950')
    expect(formatCount(1234567)).toBe('1 234 567')
  })

  it('formatLatLon uses hemisphere suffixes', () => {
    expect(formatLatLon(51.64, 14.27)).toBe('51.64°N 14.27°E')
    expect(formatLatLon(-33.9, -70.7)).toBe('33.90°S 70.70°W')
  })

  it('formatAge picks sensible units', () => {
    expect(formatAge(5 * 60_000)).toBe('5 MIN')
    expect(formatAge(3 * 3_600_000)).toBe('3 H')
    expect(formatAge(5 * 86_400_000)).toBe('5 D')
  })

  it('formatDuration renders mm:ss', () => {
    expect(formatDuration(402_000)).toBe('06:42')
    expect(formatDuration(0)).toBe('00:00')
  })

  it('formatRate marks rewind', () => {
    expect(formatRate(60)).toBe('×60')
    expect(formatRate(-60)).toBe('−×60')
  })
})
