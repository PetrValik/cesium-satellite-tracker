import { describe, expect, it, vi } from 'vitest'
import type { CameraCommand } from './cameraStore'
import {
  locateAndFly,
  locateDevice,
  locateErrorLabel,
  locateOutcomeLabel,
  LOCATE_HEIGHT_M,
  LOCATE_MAX_AGE_MS,
  LOCATE_OPTIONS,
} from './geolocation'

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

/** A geolocation that answers only when the test says so: the permission prompt is open until then. */
function pendingGeo() {
  let ok: PositionCallback = () => {}
  let fail: PositionErrorCallback | null | undefined
  return {
    getCurrentPosition: (o: PositionCallback, f?: PositionErrorCallback | null) => {
      ok = o
      fail = f
    },
    answer: () => ok(fix),
    deny: () => fail?.({ code: 1 } as GeolocationPositionError),
  }
}

/** The world as the tap sees it, plus the camera requests the flow makes. */
function world() {
  const state = { seq: 7, following: false, nowMs: 120_000 }
  const request = vi.fn<(c: CameraCommand) => void>()
  const opts = {
    request,
    seq: () => state.seq,
    following: () => state.following,
    nowMs: () => state.nowMs,
    heightM: LOCATE_HEIGHT_M,
  }
  return { state, request, opts }
}

describe('locateAndFly', () => {
  it('flies once to the fix, 500 km up, when the fix comes in time', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, w.opts)
    w.state.nowMs += 3_000
    g.answer()
    await expect(done).resolves.toEqual({ ok: true, latDeg: 50.0755, lonDeg: 14.4378, altitudeM: null })
    expect(LOCATE_HEIGHT_M).toBe(500_000)
    expect(w.request.mock.calls).toEqual([[{ kind: 'flyTo', lonDeg: 14.4378, latDeg: 50.0755, heightM: 500_000 }]])
  })
  it('drops the flight when another camera command was requested after the tap', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, w.opts)
    w.state.seq++ // e.g. HOME pressed while the prompt was open
    g.answer()
    await expect(done).resolves.toEqual({ ok: false, error: 'superseded' })
    expect(w.request).not.toHaveBeenCalled()
  })
  it('drops the flight when the follow lock engaged after the tap', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, w.opts)
    w.state.following = true // a picked ship auto-follows
    g.answer()
    await expect(done).resolves.toEqual({ ok: false, error: 'superseded' })
    expect(w.request).not.toHaveBeenCalled()
  })
  it('drops the flight when the follow lock released after the tap', async () => {
    const g = pendingGeo(), w = world()
    w.state.following = true
    const done = locateAndFly(g, w.opts)
    w.state.following = false
    g.answer()
    await expect(done).resolves.toEqual({ ok: false, error: 'superseded' })
    expect(w.request).not.toHaveBeenCalled()
  })
  it('keeps a follow lock that was already on at the tap: the flight releases it as asked', async () => {
    const g = pendingGeo(), w = world()
    w.state.following = true
    const done = locateAndFly(g, w.opts)
    g.answer()
    await expect(done).resolves.toMatchObject({ ok: true })
    expect(w.request).toHaveBeenCalledTimes(1)
  })
  it('flies up to 15 s after the tap and drops a later fix', async () => {
    expect(LOCATE_MAX_AGE_MS).toBe(15_000)
    const inTime = pendingGeo(), a = world()
    const first = locateAndFly(inTime, a.opts)
    a.state.nowMs += 15_000
    inTime.answer()
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(a.request).toHaveBeenCalledTimes(1)

    const late = pendingGeo(), b = world()
    const second = locateAndFly(late, b.opts)
    b.state.nowMs += 16_000
    late.answer()
    await expect(second).resolves.toEqual({ ok: false, error: 'late' })
    expect(b.request).not.toHaveBeenCalled()
  })
  it('honours a shorter maxAgeMs', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, { ...w.opts, maxAgeMs: 1_000 })
    w.state.nowMs += 1_001
    g.answer()
    await expect(done).resolves.toEqual({ ok: false, error: 'late' })
    expect(w.request).not.toHaveBeenCalled()
  })
  it('reports a denial as before and never flies, stale or not', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, w.opts)
    w.state.seq++
    w.state.nowMs += 60_000
    g.deny()
    const result = await done
    expect(result).toEqual({ ok: false, error: 'denied' })
    expect(w.request).not.toHaveBeenCalled()
    expect(locateOutcomeLabel(result)).toBe('LOCATION DENIED')
  })
  it('a fix superseded by a newer camera move AND late stays silent (superseded wins)', async () => {
    const g = pendingGeo(), w = world()
    const done = locateAndFly(g, w.opts)
    w.state.seq++
    w.state.nowMs += 60_000
    g.answer()
    const result = await done
    expect(result).toEqual({ ok: false, error: 'superseded' })
    expect(locateOutcomeLabel(result)).toBeNull()
  })
  it('labels a late fix so the user knows to tap again; success and superseded say nothing', async () => {
    expect(locateOutcomeLabel({ ok: false, error: 'late' })).toBe('LOCATED TOO LATE — TAP AGAIN')
    expect(locateOutcomeLabel({ ok: false, error: 'superseded' })).toBeNull()
    expect(locateOutcomeLabel({ ok: true, latDeg: 1, lonDeg: 2, altitudeM: null })).toBeNull()
    expect(locateOutcomeLabel({ ok: false, error: 'timeout' })).toBe('LOCATION TIMED OUT')
  })
  it('reports a browser without geolocation as unsupported', async () => {
    const w = world()
    await expect(locateAndFly(undefined, w.opts)).resolves.toEqual({ ok: false, error: 'unsupported' })
    expect(w.request).not.toHaveBeenCalled()
  })
})
