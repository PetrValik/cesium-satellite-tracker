import { describe, expect, it } from 'vitest'
import { satChipSummary, tleInclinationDeg } from './satSummary'

// Same ISS element set as lib/orbital.test.ts.
const ISS_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314'

describe('tleInclinationDeg', () => {
  it('reads columns 9–16 of line 2', () => {
    expect(tleInclinationDeg(ISS_TLE2)).toBe(51.6302)
  })

  it('reads a retrograde orbit above 90°', () => {
    expect(tleInclinationDeg('2 99999  98.7000 186.4276 0006683 277.8890  82.1339 14.00000000    01')).toBe(98.7)
  })

  it('rejects a blank, garbled or out-of-range field', () => {
    expect(tleInclinationDeg('2 25544')).toBeNull()
    expect(tleInclinationDeg('2 25544  5x.6302 186.4276')).toBeNull()
    expect(tleInclinationDeg('2 25544 251.6302 186.4276')).toBeNull()
  })
})

describe('satChipSummary', () => {
  it('shows the name and whole-km altitude once telemetry is live', () => {
    expect(satChipSummary(25_544, 'ISS (ZARYA)', 423.6)).toEqual({
      kind: 'SAT',
      name: 'ISS (ZARYA)',
      key: 'ALT',
      value: '424 KM',
    })
  })

  it('falls back to the NORAD id and a dash before telemetry arrives', () => {
    expect(satChipSummary(25_544, undefined, null)).toEqual({
      kind: 'SAT',
      name: 'NORAD 25544',
      key: 'ALT',
      value: '—',
    })
  })
})
