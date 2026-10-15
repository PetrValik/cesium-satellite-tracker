import { describe, expect, it } from 'vitest'
import { num, validLatLon } from '../src/shared/guards.ts'

describe('num', () => {
  it('passes finite numbers through, including zero and negatives', () => {
    expect(num(0)).toBe(0)
    expect(num(-12.5)).toBe(-12.5)
  })

  it('rejects non-numbers and non-finite numbers', () => {
    for (const v of [null, undefined, '42', NaN, Infinity, -Infinity, {}, [1]]) {
      expect(num(v)).toBeUndefined()
    }
  })
})

describe('validLatLon', () => {
  it('accepts in-range coordinates, including the exact bounds', () => {
    expect(validLatLon(51.9, 4.1)).toEqual({ lat: 51.9, lon: 4.1 })
    expect(validLatLon(-90, 180)).toEqual({ lat: -90, lon: 180 })
    expect(validLatLon(90, -180)).toEqual({ lat: 90, lon: -180 })
  })

  it('rejects a missing or out-of-range coordinate', () => {
    expect(validLatLon(undefined, 4.1)).toBeUndefined()
    expect(validLatLon(51.9, undefined)).toBeUndefined()
    expect(validLatLon(90.1, 0)).toBeUndefined()
    expect(validLatLon(0, -180.1)).toBeUndefined()
    // AIS "not available" sentinels: latitude 91, longitude 181.
    expect(validLatLon(91, 181)).toBeUndefined()
  })
})
