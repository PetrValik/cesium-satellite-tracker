import { describe, expect, it } from 'vitest'
import { parseNoradId, parseTleText } from '../src/satellites/celestrak.ts'
import { T1, T2, tleFor } from './helpers.ts'

describe('parseNoradId', () => {
  it('parses plain numeric ids', () => {
    expect(parseNoradId('25544')).toBe(25544)
    expect(parseNoradId('  544')).toBe(544)
  })

  it('decodes Alpha-5 ids (letter = 10..33, skipping I and O)', () => {
    expect(parseNoradId('A0001')).toBe(100001)
    expect(parseNoradId('B1234')).toBe(111234)
    expect(parseNoradId('Z9999')).toBe(339999)
  })

  it('rejects the unused Alpha-5 letters I and O', () => {
    expect(parseNoradId('I1234')).toBeNaN()
    expect(parseNoradId('O1234')).toBeNaN()
  })

  it('rejects garbage', () => {
    expect(parseNoradId('')).toBeNaN()
    expect(parseNoradId('12.44')).toBeNaN()
  })
})

describe('parseTleText', () => {
  it('parses 3-line entries with names', () => {
    const text = tleFor(25544, 'ISS (ZARYA)') + tleFor(20580, 'HST')
    const sats = parseTleText(text)
    expect(sats).toHaveLength(2)
    expect(sats[0]).toMatchObject({ noradId: 25544, name: 'ISS (ZARYA)' })
    expect(sats[1]).toMatchObject({ noradId: 20580, name: 'HST' })
    expect(sats[0]!.tle1).toHaveLength(69)
    expect(sats[0]!.tle2).toHaveLength(69)
  })

  it('handles CRLF line endings and trailing whitespace', () => {
    const text = tleFor(25544, 'ISS (ZARYA)').replaceAll('\n', '   \r\n')
    expect(parseTleText(text)).toHaveLength(1)
  })

  it('falls back to a NORAD name when the name line is missing', () => {
    const sats = parseTleText(`${T1}\n${T2}\n`)
    expect(sats).toHaveLength(1)
    expect(sats[0]!.name).toBe('NORAD 25544')
  })

  it('skips entries whose line-1/line-2 ids disagree', () => {
    const other = tleFor(11111, 'BROKEN').split('\n')[2]!
    const sats = parseTleText(`BROKEN\n${T1}\n${other}\n` + tleFor(20580, 'HST'))
    expect(sats.map((s) => s.noradId)).toEqual([20580])
  })

  it('skips lines with the wrong length', () => {
    const sats = parseTleText(`SHORT\n1 25544U\n2 25544\n`)
    expect(sats).toHaveLength(0)
  })

  it('returns [] for an error page instead of throwing', () => {
    expect(parseTleText('No GP data found')).toEqual([])
    expect(parseTleText('')).toEqual([])
  })

  it('decodes Alpha-5 catalog numbers in TLE lines', () => {
    const line1 = `${T1.slice(0, 2)}A0001${T1.slice(7)}`
    const line2 = `${T2.slice(0, 2)}A0001${T2.slice(7)}`
    const sats = parseTleText(`ALPHA BIRD\n${line1}\n${line2}\n`)
    expect(sats).toHaveLength(1)
    expect(sats[0]!.noradId).toBe(100001)
  })
})
