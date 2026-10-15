import { describe, expect, it } from 'vitest'
import type { Aircraft } from '@orbital-ops/shared'
import { categoryOf } from './aircraftCategory'

const plane = (icao24: string, callsign: string): Aircraft => ({
  icao24,
  callsign,
  latDeg: 47.4,
  lonDeg: 8.5,
  altM: 11_000,
  velocityMs: 240,
  trackDeg: 90,
  verticalRateMs: 0,
  onGround: false,
  tsMs: 0,
})

// 4b1814 is a Swiss civil allocation — outside every military hex block.
const CIVIL_HEX = '4b1814'

describe('categoryOf', () => {
  it('flags military ICAO-hex blocks whatever the callsign', () => {
    expect(categoryOf(plane('ae1234', 'DAL123'))).toBe('military') // USA block
    expect(categoryOf(plane('43c010', ''))).toBe('military') // UK block
    expect(categoryOf(plane('ADF7C8', ''))).toBe('military') // first hex of the USA block, upper case
  })

  it('flags a military callsign prefix followed by a digit', () => {
    expect(categoryOf(plane(CIVIL_HEX, 'RCH123'))).toBe('military')
    expect(categoryOf(plane(CIVIL_HEX, 'NOW01'))).toBe('military')
    expect(categoryOf(plane(CIVIL_HEX, ' gaf641 '))).toBe('military') // trimmed + upper-cased
  })

  it('flags a cargo airline prefix followed by a digit', () => {
    expect(categoryOf(plane(CIVIL_HEX, 'FDX1234'))).toBe('cargo')
    expect(categoryOf(plane(CIVIL_HEX, 'CMB520'))).toBe('cargo')
  })

  it('matches a callsign that is exactly a prefix', () => {
    expect(categoryOf(plane(CIVIL_HEX, 'NATO'))).toBe('military')
    expect(categoryOf(plane(CIVIL_HEX, 'UPS'))).toBe('cargo')
  })

  it('ignores a prefix followed by a letter (a word, not a flight number)', () => {
    expect(categoryOf(plane(CIVIL_HEX, 'NOWAK1'))).toBe('civil')
    expect(categoryOf(plane(CIVIL_HEX, 'UPSA12'))).toBe('civil')
  })

  it('treats short, empty and unmatched callsigns as civil', () => {
    expect(categoryOf(plane(CIVIL_HEX, 'RC'))).toBe('civil')
    expect(categoryOf(plane(CIVIL_HEX, ''))).toBe('civil')
    expect(categoryOf(plane(CIVIL_HEX, 'SWR123'))).toBe('civil')
  })

  it('falls back to the callsign when the hex does not parse', () => {
    expect(categoryOf(plane('zzzzzz', 'RCH123'))).toBe('military')
    expect(categoryOf(plane('zzzzzz', 'SWR123'))).toBe('civil')
  })
})
