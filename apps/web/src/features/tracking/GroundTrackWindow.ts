import type { SatRec } from 'satellite.js'
import { orbitalPeriodMinutes, propagateEcef } from '../../lib/orbital'

const SAMPLES_PER_PERIOD = 128
/** Fraction of the window kept behind the satellite. */
const PAST_FRACTION = 0.15

interface GridSample {
  lonDeg: number
  latDeg: number
}

/**
 * Real-time sliding ground-track window [now − 0.15 P, now + 0.85 P].
 *
 * Interior samples sit on a fixed absolute time grid (t = k · step), so
 * between frames the body of the line does not move at all — the window
 * reconciliation only drops one sample off the trailing edge and appends one
 * at the leading edge as sim time crosses grid lines. Both endpoints are
 * propagated at their exact fractional times every frame, so the tips grow
 * and recede continuously instead of popping a whole segment at a time.
 *
 * Per-frame cost: two SGP4 propagations plus at most a few grid samples.
 */
export class GroundTrackWindow {
  private readonly _satrec: SatRec
  private readonly _periodMs: number
  private readonly _stepMs: number
  /** Grid samples for k = _startK .. _startK + length − 1; NaN = failed. */
  private _samples: GridSample[] = []
  private _startK = 0
  /** [lonDeg, latDeg] pairs: exact start, grid samples, exact end. */
  private readonly _out: Float64Array

  constructor(satrec: SatRec) {
    this._satrec = satrec
    this._periodMs = orbitalPeriodMinutes(satrec) * 60_000
    this._stepMs = this._periodMs / SAMPLES_PER_PERIOD
    this._out = new Float64Array(2 * (SAMPLES_PER_PERIOD + 4))
  }

  /** Recompute the window for `epochMs`; returns [lon,lat,...] pairs. */
  update(epochMs: number): Float64Array {
    const startMs = epochMs - this._periodMs * PAST_FRACTION
    const endMs = startMs + this._periodMs
    const firstK = Math.ceil(startMs / this._stepMs)
    const lastK = Math.floor(endMs / this._stepMs)

    this._reconcile(firstK, lastK)

    const out = this._out
    let n = 0
    n = this._writeExact(startMs, n)
    for (const s of this._samples) {
      out[n++] = s.lonDeg
      out[n++] = s.latDeg
    }
    n = this._writeExact(endMs, n)
    return out.subarray(0, n)
  }

  /** Align the grid deque with [firstK, lastK], reusing overlapping samples. */
  private _reconcile(firstK: number, lastK: number): void {
    const endK = this._startK + this._samples.length - 1
    const disjoint =
      this._samples.length === 0 || firstK > endK || lastK < this._startK
    if (disjoint || Math.abs(firstK - this._startK) > SAMPLES_PER_PERIOD) {
      this._samples = []
      this._startK = firstK
      for (let k = firstK; k <= lastK; k++) this._samples.push(this._sampleAt(k))
      return
    }
    while (this._startK < firstK) {
      this._samples.shift()
      this._startK++
    }
    while (this._startK > firstK) {
      this._startK--
      this._samples.unshift(this._sampleAt(this._startK))
    }
    while (this._startK + this._samples.length - 1 < lastK) {
      this._samples.push(this._sampleAt(this._startK + this._samples.length))
    }
    while (this._startK + this._samples.length - 1 > lastK) {
      this._samples.pop()
    }
  }

  private _sampleAt(k: number): GridSample {
    const state = propagateEcef(this._satrec, k * this._stepMs)
    // NaN samples are skipped by the renderer.
    return state
      ? { lonDeg: state.lonDeg, latDeg: state.latDeg }
      : { lonDeg: Number.NaN, latDeg: Number.NaN }
  }

  private _writeExact(tMs: number, n: number): number {
    const state = propagateEcef(this._satrec, tMs)
    if (!state) return n
    this._out[n] = state.lonDeg
    this._out[n + 1] = state.latDeg
    return n + 2
  }
}
