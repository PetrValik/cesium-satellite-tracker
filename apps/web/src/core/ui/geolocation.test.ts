import { describe, expect, it, vi } from 'vitest'
import { locateDevice, locateErrorLabel, LOCATE_OPTIONS } from './geolocation'

function geo(outcome: { pos?: GeolocationPosition; code?: number }) {
  return {
    getCurrentPosition: vi.fn(
      (ok: PositionCallback, fail?: PositionErrorCallback | null, _options?: PositionOptions) => {
        if (outcome.pos) ok(outcome.pos)
        else fail?.({ code: outcome.code } as GeolocationPositionError)
      },
    ),
  }
}
const fix = { coords: { latitude: 50.0755, longitude: 14.4378, altitude: null } } as unknown as GeolocationPosition

describe('locateDevice', () => {
  it('resolves the fix and asks with the coarse options', async () => {
    const g = geo({ pos: fix })
    await expect(locateDevice(g)).resolves.toEqual({ ok: true, latDeg: 50.0755, lonDeg: 14.4378, altitudeM: null })
    expect(g.getCurrentPosition.mock.calls[0][2]).toEqual(LOCATE_OPTIONS)
    expect(LOCATE_OPTIONS).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 })
  })
  it('maps error codes 1 / 2 / 3 to denied / unavailable / timeout', async () => {
    await expect(locateDevice(geo({ code: 1 }))).resolves.toEqual({ ok: false, error: 'denied' })
    await expect(locateDevice(geo({ code: 2 }))).resolves.toEqual({ ok: false, error: 'unavailable' })
    await expect(locateDevice(geo({ code: 3 }))).resolves.toEqual({ ok: false, error: 'timeout' })
  })
  it('reports a browser without geolocation as unsupported', async () => {
    await expect(locateDevice(undefined)).resolves.toEqual({ ok: false, error: 'unsupported' })
  })
  it('labels every error for the HUD', () => {
    expect(locateErrorLabel('denied')).toBe('LOCATION DENIED')
    expect(locateErrorLabel('unavailable')).toBe('LOCATION UNAVAILABLE')
    expect(locateErrorLabel('timeout')).toBe('LOCATION TIMED OUT')
    expect(locateErrorLabel('unsupported')).toBe('NO LOCATION IN THIS BROWSER')
  })
})
