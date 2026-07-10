import { Cartesian3, Color, PointPrimitiveCollection } from 'cesium'
import type { Cartesian2, PointPrimitive, Scene } from 'cesium'
import type { Aircraft } from '@orbital-ops/shared'

/** Altitude-band colors (0.95 alpha, mirrors tokens.css hues). */
const COLOR_GROUND = Color.fromCssColorString('#8a93a3').withAlpha(0.95) // slate
const COLOR_LOW = Color.fromCssColorString('#7dd87d').withAlpha(0.95) // green, < 3000 m
const COLOR_MID = Color.fromCssColorString('#6ee7ff').withAlpha(0.95) // cyan, 3000–9000 m
const COLOR_HIGH = Color.fromCssColorString('#f0f4f8').withAlpha(0.95) // near-white, above

const PIXEL_SIZE = 2

/** Metres per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEG = 111_320
const RAD_PER_DEG = Math.PI / 180
/** Advancing more than ~4×/s buys nothing visible for aircraft-scale motion. */
const MIN_ADVANCE_INTERVAL_MS = 250
/**
 * Dead-reckoning horizon: state vectors older than this are frozen at their
 * 15-minute extrapolation so stale aircraft don't fly off across the globe.
 */
const MAX_DEAD_RECKON_MS = 15 * 60 * 1000
/**
 * cos(lat) floor for the equirectangular longitude step: keeps the division
 * sane for the (data-error) case of an aircraft reported at a pole.
 */
const MIN_COS_LAT = 0.01

// Module-scope scratch: advance() runs over thousands of points and must not
// allocate. Safe to share because PointPrimitive's `position` setter clones
// the value into its internal Cartesian3 (verified in cesium 1.138).
const scratchPosition = new Cartesian3()

/** Band color for a state vector (band chosen at set time, not re-derived per frame). */
function colorFor(aircraft: Aircraft): Color {
  if (aircraft.onGround) return COLOR_GROUND
  const altM = aircraft.altM ?? 0
  if (altM < 3000) return COLOR_LOW
  if (altM <= 9000) return COLOR_MID
  return COLOR_HIGH
}

/**
 * The ADS-B aircraft layer: one PointPrimitiveCollection, one point per
 * aircraft, keyed by ICAO 24-bit address. Between feed polls `advance()`
 * dead-reckons every aircraft with a usable velocity/track along its track
 * (cheap equirectangular step) plus vertical rate on altitude, gated to at
 * most once per 250 ms and clamped to 15 minutes of extrapolation. The
 * selected aircraft's point is hidden — a dedicated marker elsewhere
 * represents it.
 *
 * Update strategy: when a poll delivers exactly the working set we already
 * hold (same ICAO set), points and dead-reckoning state are updated in
 * place; any add/remove churn triggers a wholesale rebuild. Rebuilds happen
 * at feed cadence (seconds), never per frame, and sidestep the index
 * bookkeeping that PointPrimitiveCollection.remove's index shifting would
 * force.
 */
export class AircraftLayer {
  private readonly _scene: Scene
  private readonly _points: PointPrimitiveCollection
  private readonly _indexByIcao24 = new Map<string, number>()
  private _selectedIcao24: string | null = null
  private _lastAdvanceMs = 0

  // Dead-reckoning state in point-index order. Positions are re-derived from
  // the *state vector* each pass (lat0 + vLat * dt), so the reckoning never
  // accumulates error and is idempotent across variable frame gaps.
  private _lat0 = new Float64Array(0) // reported latitude, degrees
  private _lon0 = new Float64Array(0) // reported longitude, degrees
  private _alt0 = new Float64Array(0) // reported altitude, metres (null → 0)
  private _vLat = new Float64Array(0) // deg/s northward (0 when not reckonable)
  private _vLon = new Float64Array(0) // deg/s eastward (0 when not reckonable)
  private _vAlt = new Float64Array(0) // m/s vertical (0 when not reckonable)
  private _tsMs = new Float64Array(0) // state-vector epoch, ms

  constructor(scene: Scene) {
    this._scene = scene
    this._points = new PointPrimitiveCollection()
    scene.primitives.add(this._points)
  }

  /**
   * Accept the latest feed snapshot. Same ICAO set → in-place update of
   * positions/velocities/colors; otherwise the collection is rebuilt.
   * An empty array clears the layer. Selection survives either path (the
   * selected point stays hidden as long as its ICAO is present).
   */
  setAircraft(aircraft: Aircraft[]): void {
    if (this._isUnusable()) return

    if (this._isSameWorkingSet(aircraft)) {
      for (const state of aircraft) {
        const index = this._indexByIcao24.get(state.icao24)
        if (index === undefined) continue
        this._storeState(index, state)
        const point = this._points.get(index)
        point.color = colorFor(state)
        Cartesian3.fromDegrees(
          state.lonDeg,
          state.latDeg,
          state.altM ?? 0,
          undefined,
          scratchPosition,
        )
        point.position = scratchPosition
        point.show = state.icao24 !== this._selectedIcao24
      }
      return
    }

    // Rebuild for a materially different set.
    const points = this._points
    points.removeAll()
    this._indexByIcao24.clear()
    const n = aircraft.length
    this._lat0 = new Float64Array(n)
    this._lon0 = new Float64Array(n)
    this._alt0 = new Float64Array(n)
    this._vLat = new Float64Array(n)
    this._vLon = new Float64Array(n)
    this._vAlt = new Float64Array(n)
    this._tsMs = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const state = aircraft[i]
      this._storeState(i, state)
      Cartesian3.fromDegrees(
        state.lonDeg,
        state.latDeg,
        state.altM ?? 0,
        undefined,
        scratchPosition,
      )
      points.add({
        id: state.icao24,
        position: scratchPosition,
        pixelSize: PIXEL_SIZE,
        color: colorFor(state),
        outlineWidth: 0,
        show: state.icao24 !== this._selectedIcao24,
      })
      this._indexByIcao24.set(state.icao24, i)
    }
    if (this._selectedIcao24 !== null && !this._indexByIcao24.has(this._selectedIcao24)) {
      this._selectedIcao24 = null
    }
  }

  /**
   * Dead-reckon every reckonable aircraft to wall-clock `wallNowMs`. No-op
   * unless at least 250 ms elapsed since the last pass; extrapolation is
   * clamped to 15 minutes past the state vector. Zero allocations: one
   * shared scratch Cartesian3 is reused for every point.
   */
  advance(wallNowMs: number): void {
    if (this._isUnusable()) return
    if (wallNowMs - this._lastAdvanceMs < MIN_ADVANCE_INTERVAL_MS) return
    this._lastAdvanceMs = wallNowMs

    const points = this._points
    const count = Math.min(points.length, this._lat0.length)
    const selectedIndex =
      this._selectedIcao24 === null
        ? -1
        : (this._indexByIcao24.get(this._selectedIcao24) ?? -1)

    for (let i = 0; i < count; i++) {
      if (i === selectedIndex) continue // hidden; skip the work
      const vLat = this._vLat[i]
      const vLon = this._vLon[i]
      const vAlt = this._vAlt[i]
      // Null velocity/track zeroed all three in _storeState: not reckonable.
      if (vLat === 0 && vLon === 0 && vAlt === 0) continue
      let dtMs = wallNowMs - this._tsMs[i]
      if (dtMs <= 0) continue
      if (dtMs > MAX_DEAD_RECKON_MS) dtMs = MAX_DEAD_RECKON_MS
      const dtSec = dtMs / 1000
      let altM = this._alt0[i] + vAlt * dtSec
      if (altM < 0) altM = 0
      Cartesian3.fromDegrees(
        this._lon0[i] + vLon * dtSec,
        this._lat0[i] + vLat * dtSec,
        altM,
        undefined,
        scratchPosition,
      )
      points.get(i).position = scratchPosition
    }
  }

  /**
   * Mark one aircraft (or none) as selected. Its layer point is hidden — a
   * separate marker represents it. Unlike ConstellationLayer, the previous
   * point is re-shown here explicitly: advance() skips non-reckonable
   * aircraft, so a once-selected one would otherwise stay hidden forever.
   */
  setSelected(icao24: string | null): void {
    if (this._isUnusable()) return
    if (icao24 === this._selectedIcao24) return
    const previous = this._selectedIcao24
    this._selectedIcao24 = icao24
    if (previous !== null) {
      const point = this._pointFor(previous)
      if (point !== undefined) point.show = true
    }
    if (icao24 !== null) {
      const point = this._pointFor(icao24)
      if (point !== undefined) point.show = false
    }
  }

  /**
   * Returns the ICAO 24-bit address under the cursor if the picked primitive
   * belongs to this collection, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): string | null {
    if (scene.isDestroyed() || this._points.isDestroyed()) return null
    // Scene.pick returns { primitive, collection, id } for point primitives.
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      picked.collection === this._points &&
      typeof picked.id === 'string'
    ) {
      return picked.id
    }
    return null
  }

  /** Show or hide the whole layer (points keep updating while hidden). */
  setVisible(visible: boolean): void {
    if (this._isUnusable()) return
    this._points.show = visible
  }

  dispose(): void {
    this._indexByIcao24.clear()
    this._selectedIcao24 = null
    if (this._points.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._points)
    }
  }

  /** True when `aircraft` carries exactly the ICAOs already indexed. */
  private _isSameWorkingSet(aircraft: Aircraft[]): boolean {
    if (aircraft.length === 0 || aircraft.length !== this._indexByIcao24.size) return false
    for (const state of aircraft) {
      if (!this._indexByIcao24.has(state.icao24)) return false
    }
    return true
  }

  /**
   * Record the state vector and precompute the surface velocity in
   * degrees/second (equirectangular: dLat = v·cos(trk)/111320,
   * dLon = v·sin(trk)/(111320·cos(lat))) so advance() does no trigonometry.
   * Null velocity or track disables reckoning for this aircraft entirely.
   */
  private _storeState(index: number, aircraft: Aircraft): void {
    this._lat0[index] = aircraft.latDeg
    this._lon0[index] = aircraft.lonDeg
    this._alt0[index] = aircraft.altM ?? 0
    this._tsMs[index] = aircraft.tsMs
    if (aircraft.velocityMs === null || aircraft.trackDeg === null) {
      this._vLat[index] = 0
      this._vLon[index] = 0
      this._vAlt[index] = 0
      return
    }
    const trackRad = aircraft.trackDeg * RAD_PER_DEG
    const cosLat = Math.max(Math.cos(aircraft.latDeg * RAD_PER_DEG), MIN_COS_LAT)
    this._vLat[index] = (aircraft.velocityMs * Math.cos(trackRad)) / METERS_PER_DEG
    this._vLon[index] = (aircraft.velocityMs * Math.sin(trackRad)) / (METERS_PER_DEG * cosLat)
    this._vAlt[index] = aircraft.verticalRateMs ?? 0
  }

  private _isUnusable(): boolean {
    return this._points.isDestroyed() || this._scene.isDestroyed()
  }

  private _pointFor(icao24: string): PointPrimitive | undefined {
    const index = this._indexByIcao24.get(icao24)
    if (index === undefined || index >= this._points.length) return undefined
    return this._points.get(index)
  }
}
