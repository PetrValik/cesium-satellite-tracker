import { describe, expect, it } from 'vitest'
import { DEFAULT_OBSERVER, isValidObserver } from './observer'

describe('isValidObserver', () => {
  it('accepts the default and the coordinate limits', () => {
    expect(isValidObserver(DEFAULT_OBSERVER)).toBe(true)
    expect(isValidObserver({ latDeg: -90, lonDeg: 180, heightM: 0 })).toBe(true)
  })

  it('rejects out-of-range coordinates', () => {
    expect(isValidObserver({ latDeg: 90.01, lonDeg: 0, heightM: 0 })).toBe(false)
    expect(isValidObserver({ latDeg: 0, lonDeg: -180.5, heightM: 0 })).toBe(false)
  })

  it('rejects non-finite values in any field', () => {
    expect(isValidObserver({ latDeg: Number.NaN, lonDeg: 0, heightM: 0 })).toBe(false)
    expect(isValidObserver({ latDeg: 0, lonDeg: Number.POSITIVE_INFINITY, heightM: 0 })).toBe(false)
    expect(isValidObserver({ latDeg: 0, lonDeg: 0, heightM: Number.NaN })).toBe(false)
  })
})
