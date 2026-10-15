import type { SatRec } from 'satellite.js'
import {
  classifyOrbit,
  createSatrec,
  createSatStateEcef,
  orbitalPeriodMinutes,
  propagateEcef,
  sampleOrbitRingEci,
  type SatStateEcef,
} from '../../lib/orbital'
import { GroundTrackWindow } from './GroundTrackWindow'
import { useTelemetry } from './telemetryStore'
import type { TrackingVisuals } from './TrackingVisuals'

const MS_PER_MINUTE = 60_000
/** Telemetry readout refresh interval: ~5 Hz. */
const TELEMETRY_INTERVAL_MS = 200
/**
 * The orbit ring is sampled for one revolution from its anchor time; it is
 * re-sampled once sim time runs this fraction of a period past the anchor…
 */
const RING_LEAD_FRACTION = 0.6
/** …or this fraction of a period before it (rewind). */
const RING_LAG_FRACTION = 0.1

/** What tracking a satellite needs from its catalog entry. */
interface SatelliteTle {
  noradId: number
  name: string
  tle1: string
  tle2: string
}

/** The TrackingVisuals surface driven here — structural, so tests pass a fake. */
export type SatelliteVisuals = Pick<
  TrackingVisuals,
  'setOrbitRing' | 'setGroundTrack' | 'updateLive' | 'clear'
>

/**
 * True once sim time `epochMs` has left the ring sampled at `anchorMs`
 * (orbital period `periodMs`) by either margin.
 */
export function ringNeedsRefresh(epochMs: number, anchorMs: number, periodMs: number): boolean {
  return (
    epochMs > anchorMs + periodMs * RING_LEAD_FRACTION ||
    epochMs < anchorMs - periodMs * RING_LAG_FRACTION
  )
}

/**
 * The ONE selected satellite, propagated on the main thread every frame:
 * its SGP4 record, the orbit-ring sampling window, the sliding ground track
 * and the telemetry readout. Non-React; the host calls `select()` on a
 * selection change and `frame()` from its render loop. Owns no Cesium
 * resource — the visuals it drives are the host's to dispose.
 */
export class SelectedSatellite {
  private readonly _visuals: SatelliteVisuals
  private _satrec: SatRec | null = null
  private _name = ''
  private _groundWindow: GroundTrackWindow | null = null
  private _ringAnchorMs = 0
  private _ringPeriodMs = 0
  private _lastTelemetryMs = 0
  /** Reused propagation state: the seed in `select()` and every `frame()`. */
  private readonly _state = createSatStateEcef()

  constructor(visuals: SatelliteVisuals) {
    this._visuals = visuals
  }

  /** True while a satellite with a usable TLE is tracked. */
  get active(): boolean {
    return this._satrec !== null
  }

  /**
   * Track `sat` from sim time `epochMs` (null: deselect). Always drops the
   * previous satellite's visuals and telemetry first, so a failed TLE can't
   * leave them displayed under the new selection. Returns the state at
   * `epochMs` — the follow camera's seed, valid until the next call — or
   * null when nothing is tracked or SGP4 failed at that instant.
   */
  select(sat: SatelliteTle | null, epochMs: number): Readonly<SatStateEcef> | null {
    this._satrec = null
    this._groundWindow = null
    this._visuals.clear()
    useTelemetry.getState().clear()
    if (sat === null) return null
    const satrec = createSatrec(sat.tle1, sat.tle2)
    if (!satrec) return null
    this._satrec = satrec
    this._groundWindow = new GroundTrackWindow(satrec)
    this._name = sat.name
    useTelemetry.getState().update({
      noradId: sat.noradId,
      name: sat.name,
      orbitClass: classifyOrbit(satrec),
      periodMinutes: orbitalPeriodMinutes(satrec),
    })
    this._refreshRing(satrec, epochMs)
    return propagateEcef(satrec, epochMs, this._state)
  }

  /**
   * Per frame at sim time `epochMs` (`nowMs`: the rAF timestamp, which
   * paces telemetry): re-sample the orbit ring once sim time leaves its
   * window, slide the ground track in real time, propagate and draw the live
   * marker. Returns the live state (valid until the next call) or null when
   * nothing is tracked or SGP4 failed. Allocates nothing per frame.
   */
  frame(epochMs: number, nowMs: number): Readonly<SatStateEcef> | null {
    const satrec = this._satrec
    if (satrec === null) return null
    if (ringNeedsRefresh(epochMs, this._ringAnchorMs, this._ringPeriodMs)) {
      this._refreshRing(satrec, epochMs)
    }
    if (this._groundWindow) this._visuals.setGroundTrack(this._groundWindow.update(epochMs))
    const live = propagateEcef(satrec, epochMs, this._state)
    if (live === null) return null
    this._visuals.updateLive(live, this._name)
    if (nowMs - this._lastTelemetryMs > TELEMETRY_INTERVAL_MS) {
      this._lastTelemetryMs = nowMs
      useTelemetry.getState().update({
        altKm: live.altKm,
        velocityKmS: live.velocityKmS,
        latDeg: live.latDeg,
        lonDeg: live.lonDeg,
      })
    }
    return live
  }

  /** Sample a fresh closed ring in the inertial frame, anchored at `epochMs`. */
  private _refreshRing(satrec: SatRec, epochMs: number): void {
    // Rotated by GMST at render time (TrackingVisuals), so it turns with the sky.
    this._visuals.setOrbitRing(sampleOrbitRingEci(satrec, epochMs).eciKm)
    this._ringAnchorMs = epochMs
    this._ringPeriodMs = orbitalPeriodMinutes(satrec) * MS_PER_MINUTE
  }
}
