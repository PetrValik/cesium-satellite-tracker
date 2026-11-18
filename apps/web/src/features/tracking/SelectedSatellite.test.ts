import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  altitudeSpanKm,
  createSatrec,
  orbitalPeriodMinutes,
  propagateEcef,
} from '../../lib/orbital'
import { ringNeedsRefresh, SelectedSatellite, type SatelliteVisuals } from './SelectedSatellite'
import { useTelemetry } from './telemetryStore'

// The real sweep, wrapped so a test can count how often SelectedSatellite runs it.
vi.mock('../../lib/orbital', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/orbital')>()
  return { ...actual, altitudeSpanKm: vi.fn(actual.altitudeSpanKm) }
})
const spanSweeps = vi.mocked(altitudeSpanKm)

/** ISS (ZARYA), epoch 2026-07-10 — same fixture as orbital.test.ts. */
const ISS = {
  noradId: 25544,
  name: 'ISS (ZARYA)',
  tle1: '1 25544U 98067A   26191.15356376  .00005628  00000+0  11035-3 0  9998',
  tle2: '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314',
}
const JD_UNIX_EPOCH = 2440587.5
const satrec = createSatrec(ISS.tle1, ISS.tle2)!
const EPOCH_MS = (satrec.jdsatepoch - JD_UNIX_EPOCH) * 86_400_000
const PERIOD_MS = orbitalPeriodMinutes(satrec) * 60_000
const SHADOW_MS = EPOCH_MS + 12 * 86_400_000 + 2_945_000 // mid-eclipse 2026-07-22T04:30Z (lib/orbital.test.ts)
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

function fakeVisuals() {
  return {
    setOrbitRing: vi.fn<SatelliteVisuals['setOrbitRing']>(),
    setGroundTrack: vi.fn<SatelliteVisuals['setGroundTrack']>(),
    updateLive: vi.fn<SatelliteVisuals['updateLive']>(),
    clear: vi.fn<SatelliteVisuals['clear']>(),
  }
}

beforeEach(() => {
  useTelemetry.getState().clear()
  spanSweeps.mockClear()
})

describe('ringNeedsRefresh', () => {
  it('holds inside [anchor − 0.1 P, anchor + 0.6 P] and refreshes outside it', () => {
    expect(ringNeedsRefresh(1000, 1000, 100)).toBe(false)
    expect(ringNeedsRefresh(1060, 1000, 100)).toBe(false)
    expect(ringNeedsRefresh(1061, 1000, 100)).toBe(true)
    expect(ringNeedsRefresh(990, 1000, 100)).toBe(false)
    expect(ringNeedsRefresh(989, 1000, 100)).toBe(true)
  })
})

describe('SelectedSatellite', () => {
  it('select() clears the previous visuals, pushes identity telemetry, samples the ring and seeds the state', () => {
    const visuals = fakeVisuals()
    const sel = new SelectedSatellite(visuals)
    const seed = sel.select(ISS, EPOCH_MS)

    expect(sel.active).toBe(true)
    expect(visuals.clear).toHaveBeenCalledTimes(1)
    expect(visuals.setOrbitRing).toHaveBeenCalledTimes(1)
    const t = useTelemetry.getState()
    expect(t.noradId).toBe(25544)
    expect(t.name).toBe('ISS (ZARYA)')
    expect(t.orbitClass).toBe('LEO')
    expect(t.periodMinutes).toBeCloseTo(orbitalPeriodMinutes(satrec), 9)
    // The seed is the very propagation the follow camera sizes its range from.
    const expected = propagateEcef(satrec, EPOCH_MS)!
    expect(seed).not.toBeNull()
    expect(seed!.positionEcefM).toEqual(expected.positionEcefM)
    expect(seed!.altKm).toBe(expected.altKm)
  })

  it('a bad TLE or a deselect leaves nothing tracked and no telemetry', () => {
    const visuals = fakeVisuals()
    const sel = new SelectedSatellite(visuals)
    sel.select(ISS, EPOCH_MS)
    expect(sel.select({ ...ISS, tle2: 'garbage' }, EPOCH_MS)).toBeNull()
    expect(sel.active).toBe(false)
    expect(useTelemetry.getState().noradId).toBeNull()
    expect(sel.frame(EPOCH_MS, 0)).toBeNull()
    expect(visuals.updateLive).not.toHaveBeenCalled()

    sel.select(ISS, EPOCH_MS)
    expect(sel.select(null, EPOCH_MS)).toBeNull()
    expect(sel.active).toBe(false)
    // Every select() clears first — four selects, four clears.
    expect(visuals.clear).toHaveBeenCalledTimes(4)
  })

  it('frame() draws the live state, returns it, and reuses one state object', () => {
    const visuals = fakeVisuals()
    const sel = new SelectedSatellite(visuals)
    const seed = sel.select(ISS, EPOCH_MS)
    const a = sel.frame(EPOCH_MS + 1000, 1000)
    const b = sel.frame(EPOCH_MS + 2000, 1016)
    expect(a).toBe(seed)
    expect(b).toBe(a)
    expect(visuals.updateLive).toHaveBeenCalledTimes(2)
    expect(visuals.updateLive).toHaveBeenLastCalledWith(b, 'ISS (ZARYA)')
    expect(visuals.setGroundTrack).toHaveBeenCalledTimes(2)
    expect(b!.positionEcefM).toEqual(propagateEcef(satrec, EPOCH_MS + 2000)!.positionEcefM)
  })

  it('re-samples the ring only once sim time leaves its window', () => {
    const visuals = fakeVisuals()
    const sel = new SelectedSatellite(visuals)
    sel.select(ISS, EPOCH_MS)
    sel.frame(EPOCH_MS + 0.5 * PERIOD_MS, 0)
    sel.frame(EPOCH_MS - 0.05 * PERIOD_MS, 0)
    expect(visuals.setOrbitRing).toHaveBeenCalledTimes(1)
    sel.frame(EPOCH_MS + 0.7 * PERIOD_MS, 0)
    expect(visuals.setOrbitRing).toHaveBeenCalledTimes(2)
    // Re-anchored at +0.7 P: a jump back to the selection epoch is a rewind past the lag margin.
    sel.frame(EPOCH_MS, 0)
    expect(visuals.setOrbitRing).toHaveBeenCalledTimes(3)
  })

  it('paces live telemetry at ~5 Hz on the frame timestamp', () => {
    const sel = new SelectedSatellite(fakeVisuals())
    sel.select(ISS, EPOCH_MS)
    const latAt = (ms: number) => propagateEcef(satrec, ms)!.latDeg
    sel.frame(EPOCH_MS, 1000)
    expect(useTelemetry.getState().latDeg).toBe(latAt(EPOCH_MS))
    // Within 200 ms of the last push: the readout holds.
    sel.frame(EPOCH_MS + 60_000, 1016)
    sel.frame(EPOCH_MS + 120_000, 1200)
    expect(useTelemetry.getState().latDeg).toBe(latAt(EPOCH_MS))
    sel.frame(EPOCH_MS + 180_000, 1201)
    expect(useTelemetry.getState().latDeg).toBe(latAt(EPOCH_MS + 180_000))
    expect(useTelemetry.getState().noradId).toBe(25544)
  })

  it('select() pushes the orbit facts once, and no sunlit flag yet', () => {
    new SelectedSatellite(fakeVisuals()).select(ISS, EPOCH_MS)
    const t = useTelemetry.getState()
    expect(t.perigeeKm).toBeCloseTo(415.72, 1)
    expect(t.apogeeKm).toBeCloseTo(424.8, 1)
    expect(Math.abs(t.lowKm - 419.8)).toBeLessThan(1)
    expect(Math.abs(t.highKm - 433.0)).toBeLessThan(1)
    expect(Math.abs(t.tleEpochMs! - Date.UTC(2026, 6, 10, 3, 41, 7, 909))).toBeLessThan(1)
    expect(t.launchYear).toBe(1998)
    expect(t.designator).toBe('1998-067A')
    expect(t.sunlit).toBeNull()
  })

  it('a blank designator field pushes null launch facts', () => {
    const tle1 = ISS.tle1.slice(0, 9) + ' '.repeat(8) + ISS.tle1.slice(17)
    new SelectedSatellite(fakeVisuals()).select({ ...ISS, tle1 }, EPOCH_MS)
    expect(useTelemetry.getState().launchYear).toBeNull()
    expect(useTelemetry.getState().designator).toBeNull()
  })

  it('pushes sunlit with the 5 Hz readout, for the propagated instant', () => {
    const sel = new SelectedSatellite(fakeVisuals())
    sel.select(ISS, EPOCH_MS)
    sel.frame(EPOCH_MS, 1000)
    expect(useTelemetry.getState().sunlit).toBe(true)
    sel.frame(SHADOW_MS, 1100) // inside the 200 ms pacing window: held
    expect(useTelemetry.getState().sunlit).toBe(true)
    sel.frame(SHADOW_MS, 1300)
    expect(useTelemetry.getState().sunlit).toBe(false)
    sel.select(null, EPOCH_MS)
    expect(useTelemetry.getState().sunlit).toBeNull()
  })

  it('re-sweeps the low–high span after a multi-day warp, so NOW stays inside it', () => {
    const sel = new SelectedSatellite(fakeVisuals())
    sel.select(ISS, EPOCH_MS)
    const at = EPOCH_MS + 3 * DAY_MS
    sel.frame(at, 1000)
    const { lowKm, highKm } = useTelemetry.getState()
    const expected = altitudeSpanKm(satrec, at)
    expect(Math.abs(lowKm - expected.lowKm)).toBeLessThan(0.01)
    expect(Math.abs(highKm - expected.highKm)).toBeLessThan(0.01)
    // The live readout across that day (each push 300 ms apart, so each is taken) stays inside.
    for (const [k, h] of [0.5, 3, 6, 9, 11.5].entries()) {
      sel.frame(at + h * HOUR_MS, 1300 + 300 * k)
      const t = useTelemetry.getState()
      expect(t.lowKm).toBe(lowKm)
      expect(t.altKm).toBe(propagateEcef(satrec, at + h * HOUR_MS)!.altKm)
      expect(t.altKm).toBeGreaterThanOrEqual(lowKm - 0.5)
      expect(t.altKm).toBeLessThanOrEqual(highKm + 0.5)
    }
  })

  it('holds the span within 12 h of the instant it was swept for, and re-sweeps only at the 5 Hz push', () => {
    const sel = new SelectedSatellite(fakeVisuals())
    sel.select(ISS, EPOCH_MS)
    expect(spanSweeps).toHaveBeenCalledTimes(1)
    const { lowKm, highKm } = useTelemetry.getState()
    let now = 1000
    for (const h of [1, 6, 11.9, 12, -6, -12]) sel.frame(EPOCH_MS + h * HOUR_MS, (now += 300))
    expect(spanSweeps).toHaveBeenCalledTimes(1)
    expect(useTelemetry.getState().lowKm).toBe(lowKm)
    expect(useTelemetry.getState().highKm).toBe(highKm)
    // Past 12 h but inside the 200 ms pacing window: no sweep on this frame…
    const past = EPOCH_MS + 13 * HOUR_MS
    sel.frame(past, now + 100)
    expect(spanSweeps).toHaveBeenCalledTimes(1)
    // …the next paced push takes it, for that push's instant.
    sel.frame(past, (now += 300))
    expect(spanSweeps).toHaveBeenCalledTimes(2)
    expect(spanSweeps.mock.lastCall?.[1]).toBe(past)
    // Re-anchored at +13 h: +24 h is 11 h away and holds.
    sel.frame(EPOCH_MS + 24 * HOUR_MS, (now += 300))
    expect(spanSweeps).toHaveBeenCalledTimes(2)
  })

  it('a warp back more than 12 h re-sweeps the span too', () => {
    const sel = new SelectedSatellite(fakeVisuals())
    const start = EPOCH_MS + 3 * DAY_MS
    sel.select(ISS, start)
    sel.frame(start - 11 * HOUR_MS, 1000)
    expect(spanSweeps).toHaveBeenCalledTimes(1)
    const back = start - 12 * HOUR_MS - 60_000
    sel.frame(back, 1300)
    expect(spanSweeps).toHaveBeenCalledTimes(2)
    const expected = altitudeSpanKm(satrec, back)
    expect(Math.abs(useTelemetry.getState().lowKm - expected.lowKm)).toBeLessThan(0.01)
    expect(Math.abs(useTelemetry.getState().highKm - expected.highKm)).toBeLessThan(0.01)
  })
})
