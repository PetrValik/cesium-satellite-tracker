import { describe, expect, it } from 'vitest'
import type { Ship } from '@orbital-ops/shared'
import { formatSog, shipChipSummary, vesselName } from './shipSummary'

const ship: Ship = {
  mmsi: 211_000_001,
  name: 'EVER GIVEN',
  latDeg: 54,
  lonDeg: 8,
  sogKn: 12.345,
  cogDeg: 90,
  hdgDeg: 88,
  shipType: 'cargo',
  tsMs: 0,
}

describe('vesselName', () => {
  it('uses the AIS name, else the MMSI', () => {
    expect(vesselName(ship, ship.mmsi)).toBe('EVER GIVEN')
    expect(vesselName({ ...ship, name: '' }, ship.mmsi)).toBe('MMSI 211000001')
    expect(vesselName(undefined, 211_000_002)).toBe('MMSI 211000002')
  })
})

describe('formatSog', () => {
  it('shows one decimal knot', () => {
    expect(formatSog(12.345)).toBe('12.3 KN')
    expect(formatSog(0)).toBe('0.0 KN')
  })
})

describe('shipChipSummary', () => {
  it('condenses the vessel to name + SOG', () => {
    expect(shipChipSummary(ship.mmsi, ship)).toEqual({
      kind: 'VSL',
      name: 'EVER GIVEN',
      key: 'SOG',
      value: '12.3 KN',
    })
  })

  it('keeps the MMSI and a dash once the vessel aged out', () => {
    expect(shipChipSummary(211_000_002, undefined)).toEqual({
      kind: 'VSL',
      name: 'MMSI 211000002',
      key: 'SOG',
      value: '—',
    })
  })
})
