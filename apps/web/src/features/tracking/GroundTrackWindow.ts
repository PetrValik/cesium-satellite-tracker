import type { SatRec } from 'satellite.js'
import { createSatStateEcef, orbitalPeriodMinutes, propagateEcef } from '../../lib/orbital'

const SAMPLES_PER_PERIOD = 128
/** Fraction of the window kept behind the satellite. */
const PAST_FRACTION = 0.15
/**
 * Grid samples a window can hold. A one-period window spans 128 steps, so it
 * covers 128 or 129 grid lines; two spare slots absorb floating-point edges.
 */
const MAX_GRID_SAMPLES = SAMPLES_PER_PERIOD + 2
const MS_PER_MINUTE = 60_000

/**
 * Propagation target for every sample: update() reads only lon/lat out of it
 * before the next call overwrites it, so one module-scope state is enough.
 */
const scratchState = createSatStateEcef()

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
 * Per-frame cost: two SGP4 propagations plus at most a few grid samples, and
 * no allocation — the grid is a fixed ring buffer, every propagation writes
 * into one scratch state, and the returned view is cached per length.
 */
export class GroundTrackWindow {
  private readonly _satrec: SatRec
  private readonly _periodMs: number
  private readonly _stepMs: number
  /** Grid ring buffer: k = _startK + i lives at slot (_head + i) % MAX_GRID_SAMPLES; NaN = failed. */
  private readonly _gridLon = new Float64Array(MAX_GRID_SAMPLES)
  private readonly _gridLat = new Float64Array(MAX_GRID_SAMPLES)
  private _head = 0
  private _count = 0
  private _startK = 0
  /** [lonDeg, latDeg] pairs: exact start, grid samples, exact end. */
  private readonly _out = new Float64Array(2 * (MAX_GRID_SAMPLES + 2))
  /** `_out.subarray(0, n)` views, created once per distinct length n. */
  private readonly _views: (Float64Array | undefined)[] = []

  constructor(satrec: SatRec) {
    this._satrec = satrec
    this._periodMs = orbitalPeriodMinutes(satrec) * MS_PER_MINUTE
    this._stepMs = this._periodMs / SAMPLES_PER_PERIOD
  }

  /**
   * Recompute the window for `epochMs`; returns [lon,lat,...] pairs. The
   * returned view aliases an internal buffer: it is valid until the next
   * call, so read it before calling update() again.
   */
  update(epochMs: number): Float64Array {
    const startMs = epochMs - this._periodMs * PAST_FRACTION
    const endMs = startMs + this._periodMs
    const firstK = Math.ceil(startMs / this._stepMs)
    const lastK = Math.min(Math.floor(endMs / this._stepMs), firstK + MAX_GRID_SAMPLES - 1)

    this._reconcile(firstK, lastK)

    const out = this._out
    let n = this._writeExact(startMs, 0)
    for (let i = 0; i < this._count; i++) {
      const slot = (this._head + i) % MAX_GRID_SAMPLES
      out[n++] = this._gridLon[slot]
      out[n++] = this._gridLat[slot]
    }
    n = this._writeExact(endMs, n)
    return (this._views[n] ??= out.subarray(0, n))
  }

  /** Align the grid ring with [firstK, lastK], reusing overlapping samples. */
  private _reconcile(firstK: number, lastK: number): void {
    const endK = this._startK + this._count - 1
    const disjoint = this._count === 0 || firstK > endK || lastK < this._startK
    if (disjoint || Math.abs(firstK - this._startK) > SAMPLES_PER_PERIOD) {
      this._head = 0
      this._count = 0
      this._startK = firstK
      for (let k = firstK; k <= lastK; k++) this._push(k)
      return
    }
    // Trim both ends before extending either, so the ring never holds more
    // than the final window (a rewind would otherwise overfill it).
    while (this._startK < firstK) {
      this._head = (this._head + 1) % MAX_GRID_SAMPLES
      this._count--
      this._startK++
    }
    while (this._startK + this._count - 1 > lastK) this._count--
    while (this._startK > firstK) {
      this._head = (this._head + MAX_GRID_SAMPLES - 1) % MAX_GRID_SAMPLES
      this._count++
      this._startK--
      this._sampleInto(this._head, this._startK)
    }
    while (this._startK + this._count - 1 < lastK) this._push(this._startK + this._count)
  }

  /** Append grid sample k at the back of the ring. */
  private _push(k: number): void {
    this._sampleInto((this._head + this._count) % MAX_GRID_SAMPLES, k)
    this._count++
  }

  private _sampleInto(slot: number, k: number): void {
    const state = propagateEcef(this._satrec, k * this._stepMs, scratchState)
    // NaN samples are skipped by the renderer.
    this._gridLon[slot] = state ? state.lonDeg : Number.NaN
    this._gridLat[slot] = state ? state.latDeg : Number.NaN
  }

  private _writeExact(tMs: number, n: number): number {
    const state = propagateEcef(this._satrec, tMs, scratchState)
    if (!state) return n
    this._out[n] = state.lonDeg
    this._out[n + 1] = state.latDeg
    return n + 2
  }
}
