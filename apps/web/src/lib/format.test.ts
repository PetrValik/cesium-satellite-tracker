import { describe, expect, it } from 'vitest'
import {
  formatAge,
  formatCompass8,
  formatCount,
  formatCountdown,
  formatDataAge,
  formatDuration,
  formatLatLon,
  formatRate,
  formatUtc,
  formatUtcHm,
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

  it('formatCountdown: rounded-up minutes, H MM from an hour', () => {
    expect(formatCountdown(7_620_000)).toBe('2 H 07')
    expect(formatCountdown(180_000)).toBe('3 MIN')
    expect(formatCountdown(20_000)).toBe('1 MIN')
    expect(formatCountdown(0)).toBe('1 MIN')
    expect(formatCountdown(3_540_001)).toBe('1 H 00')
    expect(formatCountdown(476_250)).toBe('8 MIN') // a pass duration
  })
  it('formatCompass8: 45° sectors centred on the points, boundaries go clockwise', () => {
    const cases: [number, string][] = [[0, 'N'], [22.4, 'N'], [22.5, 'NE'], [90, 'E'], [179.2, 'S'], [226.6, 'SW'],
      [260.3, 'W'], [292.5, 'NW'], [337.4, 'NW'], [337.5, 'N'], [359.9, 'N'], [360, 'N'], [-45, 'NW']]
    for (const [az, point] of cases) expect(formatCompass8(az)).toBe(point)
    expect(formatCompass8(Number.NaN)).toBe('—')
  })
  it('formatDataAge: magnitude with OLD / AHEAD', () => {
    expect(formatDataAge(25 * 60_000)).toBe('25 MIN OLD')
    expect(formatDataAge(-5 * 3_600_000)).toBe('5.0 H AHEAD')
    expect(formatDataAge(103_680_000)).toBe('1.2 D OLD')
    expect(formatDataAge(15 * 86_400_000)).toBe('15 D OLD')
    expect(formatDataAge(0)).toBe('0 MIN OLD')
  // unit edges: a value that rounds up into the next unit reads in that unit
  expect(formatDataAge(59.6 * 60_000)).toBe('1.0 H OLD')
  expect(formatDataAge(23.97 * 3_600_000)).toBe('1.0 D OLD')
  expect(formatDataAge(9.97 * 86_400_000)).toBe('10 D OLD')
  })
  it('formatUtcHm renders HH:MM UTC with seconds truncated', () => {
    expect(formatUtcHm(Date.UTC(2026, 6, 10, 18, 42, 59))).toBe('18:42')
    expect(formatUtcHm(Date.UTC(2026, 6, 10, 3, 5, 0))).toBe('03:05')
  })
})
