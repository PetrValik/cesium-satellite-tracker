import { describe, expect, it } from 'vitest'
import type { Aircraft } from '@orbital-ops/shared'
import { aircraftChipSummary, aircraftName, formatAircraftAlt } from './aircraftSummary'

const aircraft: Aircraft = {
  icao24: '4ca123',
  callsign: 'RYR12AB',
  latDeg: 50,
  lonDeg: 14,
  altM: 10_972.6,
  velocityMs: 230,
  trackDeg: 90,
  verticalRateMs: 0,
  onGround: false,
  tsMs: 0,
}

describe('aircraftName', () => {
  it('uses the callsign, else the upper-case ICAO24', () => {
    expect(aircraftName(aircraft, aircraft.icao24)).toBe('RYR12AB')
    expect(aircraftName({ ...aircraft, callsign: '' }, aircraft.icao24)).toBe('4CA123')
    expect(aircraftName(undefined, 'abc123')).toBe('ABC123')
  })
})

describe('formatAircraftAlt', () => {
  it('rounds to whole metres', () => {
    expect(formatAircraftAlt(aircraft)).toBe('10973 M')
  })

  it('says GROUND on the ground, even with an altitude reported', () => {
    expect(formatAircraftAlt({ onGround: true, altM: 120 })).toBe('GROUND')
  })

  it('shows a dash for an unknown altitude in the air', () => {
    expect(formatAircraftAlt({ onGround: false, altM: null })).toBe('—')
  })
})

describe('aircraftChipSummary', () => {
  it('condenses the aircraft to name + ALT', () => {
    expect(aircraftChipSummary(aircraft.icao24, aircraft)).toEqual({
      kind: 'ACFT',
      name: 'RYR12AB',
      key: 'ALT',
      value: '10973 M',
    })
  })

  it('keeps the address and a dash once the aircraft aged out', () => {
    expect(aircraftChipSummary('abc123', undefined)).toEqual({
      kind: 'ACFT',
      name: 'ABC123',
      key: 'ALT',
      value: '—',
    })
  })
})
