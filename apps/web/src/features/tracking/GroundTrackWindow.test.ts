import { describe, expect, it } from 'vitest'
import type { SatRec } from 'satellite.js'
import { createSatrec, orbitalPeriodMinutes, propagateEcef } from '../../lib/orbital'
import { GroundTrackWindow } from './GroundTrackWindow'

/** ISS (ZARYA), epoch 2026-07-10 — same fixture as orbital.test.ts. */
const ISS_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  11035-3 0  9998'
const ISS_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314'
const JD_UNIX_EPOCH = 2440587.5

function setup() {
  const satrec = createSatrec(ISS_TLE1, ISS_TLE2)!
  const epochMs = (satrec.jdsatepoch - JD_UNIX_EPOCH) * 86_400_000
  return { satrec, epochMs, window: new GroundTrackWindow(satrec) }
}

/**
 * From-scratch reference: every grid sample is a pure function of k, so the
 * incremental window must equal propagating the whole window afresh.
 */
function referenceWindow(satrec: SatRec, epochMs: number): number[] {
  const periodMs = orbitalPeriodMinutes(satrec) * 60_000
  const stepMs = periodMs / 128
  const startMs = epochMs - periodMs * 0.15
  const endMs = startMs + periodMs
  const out: number[] = []
  const exact = (tMs: number) => {
    const s = propagateEcef(satrec, tMs)
    if (s) out.push(s.lonDeg, s.latDeg)
  }
  exact(startMs)
  for (let k = Math.ceil(startMs / stepMs); k <= Math.floor(endMs / stepMs); k++) {
    const s = propagateEcef(satrec, k * stepMs)
    out.push(s ? s.lonDeg : Number.NaN, s ? s.latDeg : Number.NaN)
  }
  exact(endMs)
  return out
}

describe('GroundTrackWindow', () => {
  it('produces a finite lon/lat window bounded by the inclination', () => {
    const { epochMs, window } = setup()
    const out = window.update(epochMs)
    expect(out.length).toBeGreaterThan(2 * 120)
    expect(out.length % 2).toBe(0)
    for (let i = 0; i < out.length; i += 2) {
      expect(Number.isFinite(out[i])).toBe(true)
      expect(Math.abs(out[i])).toBeLessThanOrEqual(180)
      expect(Math.abs(out[i + 1])).toBeLessThanOrEqual(51.8) // inclination bound
    }
  })

  it('keeps interior grid samples identical while the window slides', () => {
    const { satrec, epochMs, window } = setup()
    const stepMs = ((2 * Math.PI) / satrec.no) * 60_000 / 128
    const a = Array.from(window.update(epochMs))
    const b = Array.from(window.update(epochMs + stepMs))
    // After sliding by exactly one grid step, sample k+1 of the first output
    // (grid part starts at index 2, after the exact-start endpoint) must equal
    // sample k of the second output — the body of the line did not move.
    expect(b[2]).toBeCloseTo(a[4], 10)
    expect(b[3]).toBeCloseTo(a[5], 10)
    expect(b[20]).toBeCloseTo(a[22], 10)
    expect(b[21]).toBeCloseTo(a[23], 10)
  })

  it('survives arbitrary jumps and rewind', () => {
    const { epochMs, window } = setup()
    window.update(epochMs)
    const dayAhead = window.update(epochMs + 86_400_000)
    expect(dayAhead.length).toBeGreaterThan(0)
    const rewound = window.update(epochMs - 3_600_000)
    expect(rewound.length).toBeGreaterThan(0)
    for (let i = 1; i < rewound.length; i += 2) {
      expect(Math.abs(rewound[i])).toBeLessThanOrEqual(51.8)
    }
  })

  it('matches the from-scratch window exactly across slides, jumps and rewinds', () => {
    const { satrec, epochMs, window } = setup()
    const stepMs = ((2 * Math.PI) / satrec.no) * 60_000 / 128
    const offsets = [
      0, 16, 1_000, stepMs / 2, stepMs, 3 * stepMs, -2 * stepMs, 2 * stepMs + 7, // slides
      -3_600_000, 86_400_000, 86_400_000 + 0.9 * 128 * stepMs, 5, // jumps + rewind
    ]
    let t = epochMs
    for (const offset of offsets) {
      t += offset
      expect(Array.from(window.update(t))).toEqual(referenceWindow(satrec, t))
    }
    // A deterministic pseudo-random walk across many frames.
    let seed = 12345
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      t += ((seed / 2 ** 31) - 0.3) * 4 * stepMs
      expect(Array.from(window.update(t))).toEqual(referenceWindow(satrec, t))
    }
  })

  it('returns the same view object while the window length is unchanged (no per-frame allocation)', () => {
    const { epochMs, window } = setup()
    const a = window.update(epochMs)
    const b = window.update(epochMs)
    expect(b).toBe(a)
    expect(b.buffer).toBe(window.update(epochMs + 60_000).buffer) // always the one buffer
  })
})
