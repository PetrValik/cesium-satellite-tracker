import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSatrec, orbitalPeriodMinutes, propagateEcef } from '../../lib/orbital'
import { ringNeedsRefresh, SelectedSatellite, type SatelliteVisuals } from './SelectedSatellite'
import { useTelemetry } from './telemetryStore'

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

function fakeVisuals() {
  return {
    setOrbitRing: vi.fn<SatelliteVisuals['setOrbitRing']>(),
    setGroundTrack: vi.fn<SatelliteVisuals['setGroundTrack']>(),
    updateLive: vi.fn<SatelliteVisuals['updateLive']>(),
    clear: vi.fn<SatelliteVisuals['clear']>(),
  }
}

beforeEach(() => useTelemetry.getState().clear())

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
})
