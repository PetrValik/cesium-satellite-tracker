import { Cartesian3, Color, PointPrimitiveCollection } from 'cesium'
import type { Cartesian2, PointPrimitive, Scene } from 'cesium'
import type { Ship, ShipType } from '@orbital-ops/shared'

/** Design tokens per vessel category (0.95 alpha, mirrors tokens.css hues). */
const TYPE_COLORS: Record<ShipType, Color> = {
  cargo: Color.fromCssColorString('#6ee7ff').withAlpha(0.95), // cyan
  tanker: Color.fromCssColorString('#ffb454').withAlpha(0.95), // signal amber
  passenger: Color.fromCssColorString('#c084fc').withAlpha(0.95), // violet
  fishing: Color.fromCssColorString('#7dd87d').withAlpha(0.95), // green
  highspeed: Color.fromCssColorString('#f0f4f8').withAlpha(0.95), // near-white
  other: Color.fromCssColorString('#8a93a3').withAlpha(0.95), // slate
}

const PIXEL_SIZE = 2

const KNOTS_TO_MS = 0.514444
/** Metres per degree of latitude (and of longitude at the equator). */
const METERS_PER_DEG = 111_320
const RAD_PER_DEG = Math.PI / 180
/** Below this speed over ground the vessel is treated as moored (no dead reckoning). */
const MOORED_SOG_KN = 0.2
/**
 * Ships crawl relative to pixels: even at 30 kn a vessel covers ~4 m in
 * 250 ms, far below one pixel at any usable zoom, so advancing more often is
 * pure waste.
 */
const MIN_ADVANCE_INTERVAL_MS = 250
/**
 * cos(lat) floor for the equirectangular longitude step: keeps the division
 * sane for the (data-error) case of a vessel reported at a pole.
 */
const MIN_COS_LAT = 0.01

// Module-scope scratch: advance() runs over thousands of points and must not
// allocate. Safe to share because PointPrimitive's `position` setter clones
// the value into its internal Cartesian3 (verified in cesium 1.138).
const scratchPosition = new Cartesian3()

/**
 * The AIS vessel layer: one PointPrimitiveCollection, one point per ship,
 * keyed by MMSI. Between feed polls `advance()` dead-reckons every moving
 * vessel from its last report (constant course/speed, cheap equirectangular
 * step), gated to at most once per 250 ms. The selected ship's point is
 * hidden — a dedicated marker elsewhere represents it.
 *
 * Update strategy: when a poll delivers exactly the working set we already
 * hold (same MMSIs), points and dead-reckoning state are updated in place;
 * any add/remove churn triggers a wholesale rebuild. Rebuilds happen at feed
 * cadence (seconds), never per frame, and sidestep the index bookkeeping
 * that PointPrimitiveCollection.remove's index shifting would force.
 */
export class ShipsLayer {
  private readonly _scene: Scene
  private readonly _points: PointPrimitiveCollection
  private readonly _indexByMmsi = new Map<number, number>()
  private _selectedMmsi: number | null = null
  private _lastAdvanceMs = 0

  // Dead-reckoning state in point-index order. Positions are re-derived from
  // the *report* each pass (lat0 + vLat * dt), so the reckoning never
  // accumulates error and is idempotent across variable frame gaps.
  private _lat0 = new Float64Array(0) // reported latitude, degrees
  private _lon0 = new Float64Array(0) // reported longitude, degrees
  private _vLat = new Float64Array(0) // deg/s northward (0 when moored)
  private _vLon = new Float64Array(0) // deg/s eastward (0 when moored)
  private _tsMs = new Float64Array(0) // report epoch, ms

  constructor(scene: Scene) {
    this._scene = scene
    this._points = new PointPrimitiveCollection()
    scene.primitives.add(this._points)
  }

  /**
   * Accept the latest feed snapshot. Same MMSI set → in-place update of
   * positions/velocities/colors; otherwise the collection is rebuilt.
   * An empty array clears the layer. Selection survives either path (the
   * selected point stays hidden as long as its MMSI is present).
   */
  setShips(ships: Ship[]): void {
    if (this._isUnusable()) return

    if (this._isSameWorkingSet(ships)) {
      for (const ship of ships) {
        const index = this._indexByMmsi.get(ship.mmsi)
        if (index === undefined) continue
        this._storeState(index, ship)
        const point = this._points.get(index)
        point.color = TYPE_COLORS[ship.shipType]
        Cartesian3.fromDegrees(ship.lonDeg, ship.latDeg, 0, undefined, scratchPosition)
        point.position = scratchPosition
        point.show = ship.mmsi !== this._selectedMmsi
      }
      return
    }

    // Rebuild for a materially different set.
    const points = this._points
    points.removeAll()
    this._indexByMmsi.clear()
    const n = ships.length
    this._lat0 = new Float64Array(n)
    this._lon0 = new Float64Array(n)
    this._vLat = new Float64Array(n)
    this._vLon = new Float64Array(n)
    this._tsMs = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const ship = ships[i]
      this._storeState(i, ship)
      Cartesian3.fromDegrees(ship.lonDeg, ship.latDeg, 0, undefined, scratchPosition)
      points.add({
        id: ship.mmsi,
        position: scratchPosition,
        pixelSize: PIXEL_SIZE,
        color: TYPE_COLORS[ship.shipType],
        outlineWidth: 0,
        show: ship.mmsi !== this._selectedMmsi,
      })
      this._indexByMmsi.set(ship.mmsi, i)
    }
    if (this._selectedMmsi !== null && !this._indexByMmsi.has(this._selectedMmsi)) {
      this._selectedMmsi = null
    }
  }

  /**
   * Dead-reckon every moving vessel to wall-clock `wallNowMs`. No-op unless
   * at least 250 ms elapsed since the last pass. Zero allocations: one shared
   * scratch Cartesian3 is reused for every point.
   */
  advance(wallNowMs: number): void {
    if (this._isUnusable()) return
    if (wallNowMs - this._lastAdvanceMs < MIN_ADVANCE_INTERVAL_MS) return
    this._lastAdvanceMs = wallNowMs

    const points = this._points
    const count = Math.min(points.length, this._lat0.length)
    const selectedIndex =
      this._selectedMmsi === null ? -1 : (this._indexByMmsi.get(this._selectedMmsi) ?? -1)

    for (let i = 0; i < count; i++) {
      if (i === selectedIndex) continue // hidden; skip the work
      const vLat = this._vLat[i]
      const vLon = this._vLon[i]
      if (vLat === 0 && vLon === 0) continue // moored (sog < 0.2 kn)
      const dtSec = (wallNowMs - this._tsMs[i]) / 1000
      if (dtSec <= 0) continue
      Cartesian3.fromDegrees(
        this._lon0[i] + vLon * dtSec,
        this._lat0[i] + vLat * dtSec,
        0,
        undefined,
        scratchPosition,
      )
      points.get(i).position = scratchPosition
    }
  }

  /**
   * Mark one vessel (or none) as selected. Its layer point is hidden — a
   * separate marker represents it. Unlike ConstellationLayer, the previous
   * point is re-shown here explicitly: advance() skips moored ships, so a
   * once-selected stationary vessel would otherwise stay hidden forever.
   */
  setSelected(mmsi: number | null): void {
    if (this._isUnusable()) return
    if (mmsi === this._selectedMmsi) return
    const previous = this._selectedMmsi
    this._selectedMmsi = mmsi
    if (previous !== null) {
      const point = this._pointFor(previous)
      if (point !== undefined) point.show = true
    }
    if (mmsi !== null) {
      const point = this._pointFor(mmsi)
      if (point !== undefined) point.show = false
    }
  }

  /**
   * Returns the MMSI under the cursor if the picked primitive belongs to
   * this collection, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): number | null {
    if (scene.isDestroyed() || this._points.isDestroyed()) return null
    // Scene.pick returns { primitive, collection, id } for point primitives.
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      picked.collection === this._points &&
      typeof picked.id === 'number'
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
    this._indexByMmsi.clear()
    this._selectedMmsi = null
    if (this._points.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._points)
    }
  }

  /** True when `ships` carries exactly the MMSIs already indexed. */
  private _isSameWorkingSet(ships: Ship[]): boolean {
    if (ships.length === 0 || ships.length !== this._indexByMmsi.size) return false
    for (const ship of ships) {
      if (!this._indexByMmsi.has(ship.mmsi)) return false
    }
    return true
  }

  /**
   * Record the report and precompute the surface velocity in degrees/second
   * (equirectangular: dLat = v·cos(brg)/111320, dLon = v·sin(brg)/(111320·cos(lat)))
   * so advance() does no trigonometry.
   */
  private _storeState(index: number, ship: Ship): void {
    this._lat0[index] = ship.latDeg
    this._lon0[index] = ship.lonDeg
    this._tsMs[index] = ship.tsMs
    if (ship.sogKn < MOORED_SOG_KN) {
      this._vLat[index] = 0
      this._vLon[index] = 0
      return
    }
    const speedMs = ship.sogKn * KNOTS_TO_MS
    const bearingRad = ship.cogDeg * RAD_PER_DEG
    const cosLat = Math.max(Math.cos(ship.latDeg * RAD_PER_DEG), MIN_COS_LAT)
    this._vLat[index] = (speedMs * Math.cos(bearingRad)) / METERS_PER_DEG
    this._vLon[index] = (speedMs * Math.sin(bearingRad)) / (METERS_PER_DEG * cosLat)
  }

  private _isUnusable(): boolean {
    return this._points.isDestroyed() || this._scene.isDestroyed()
  }

  private _pointFor(mmsi: number): PointPrimitive | undefined {
    const index = this._indexByMmsi.get(mmsi)
    if (index === undefined || index >= this._points.length) return undefined
    return this._points.get(index)
  }
}
