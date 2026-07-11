import { BillboardCollection, BlendOption, Cartesian3, Color, NearFarScalar } from 'cesium'
import type { Billboard, Cartesian2, Scene } from 'cesium'
import { shipIcon } from '../../core/engine/icons'
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

/**
 * Distance scaling: the hull sprite is 64 px and Billboard.scale multiplies
 * it, so targetPx / 64 is the scale. Tuned for surface objects:
 *  - within 8e4 m (~80 km, harbor/coastal view): 28 / 64 → a ~28 px hull
 *    whose bow direction is readable;
 *  - beyond 6e6 m (pulling out toward globe view): 4 / 64 → a ~4 px dot.
 * Shared across all billboards; the Billboard constructor clones it
 * (NearFarScalar.clone in cesium 1.138) and we never mutate it.
 */
const SPRITE_PX = 64
const SCALE_BY_DISTANCE = new NearFarScalar(8e4, 28 / SPRITE_PX, 6e6, 4 / SPRITE_PX)

/** One fixed atlas id: every billboard shares the single hull sprite entry. */
const SHIP_IMAGE_ID = 'icon:ship'

/**
 * Rotation refresh gate: rewriting Billboard.rotation dirties per-billboard
 * vertex data, and re-rotating 10k billboards every frame while the camera
 * is still is pure waste. The rotation pass therefore only runs when the
 * camera heading has drifted more than this (~1.1°, comfortably below what
 * the eye can read on a 28 px glyph) since the last applied pass, or when
 * setShips changed the data set.
 */
const HEADING_EPSILON_RAD = 0.02

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

// Module-scope scratch: advance() runs over thousands of billboards and must
// not allocate. Safe to share because Billboard's `position` setter clones
// the value into its internal Cartesian3 (verified in cesium 1.138).
const scratchPosition = new Cartesian3()

/**
 * The AIS vessel layer: one BillboardCollection, one tinted hull sprite per
 * ship, keyed by MMSI. Between feed polls `advance()` dead-reckons every
 * moving vessel from its last report (constant course/speed, cheap
 * equirectangular step), gated to at most once per 250 ms. Each moving hull
 * is rotated to point along its course over ground; because billboards
 * rotate in screen space, the rotation must compensate the camera heading
 * (rotation = -cogRad - camera.heading) and is refreshed on a heading-gated
 * pass. The selected ship's billboard is hidden — a dedicated marker
 * elsewhere represents it.
 *
 * Update strategy: when a poll delivers exactly the working set we already
 * hold (same MMSIs), billboards and dead-reckoning state are updated in
 * place; any add/remove churn triggers a wholesale rebuild. Rebuilds happen
 * at feed cadence (seconds), never per frame.
 */
export class ShipsLayer {
  private readonly _scene: Scene
  private readonly _billboards: BillboardCollection
  private readonly _indexByMmsi = new Map<number, number>()
  private _selectedMmsi: number | null = null
  private _lastAdvanceMs = 0
  private _rotationsDirty = false
  /** Infinity → the first rotation pass always applies. */
  private _lastAppliedHeadingRad = Number.POSITIVE_INFINITY

  // Dead-reckoning state in billboard-index order. Positions are re-derived
  // from the *report* each pass (lat0 + vLat * dt), so the reckoning never
  // accumulates error and is idempotent across variable frame gaps.
  private _lat0 = new Float64Array(0) // reported latitude, degrees
  private _lon0 = new Float64Array(0) // reported longitude, degrees
  private _vLat = new Float64Array(0) // deg/s northward (0 when moored)
  private _vLon = new Float64Array(0) // deg/s eastward (0 when moored)
  private _tsMs = new Float64Array(0) // report epoch, ms
  private _cogRad = new Float64Array(0) // course over ground, radians CW from north

  constructor(scene: Scene) {
    this._scene = scene
    this._billboards = new BillboardCollection({
      // All tints carry alpha < 1: one translucent pass (depth test stays
      // on) instead of opaque + translucent.
      blendOption: BlendOption.TRANSLUCENT,
    })
    scene.primitives.add(this._billboards)
  }

  /**
   * Accept the latest feed snapshot. Same MMSI set → in-place update of
   * positions/velocities/colors; otherwise the collection is rebuilt.
   * An empty array clears the layer. Selection survives either path (the
   * selected billboard stays hidden as long as its MMSI is present).
   * Rotations are (re)applied by the next advance() pass.
   */
  setShips(ships: Ship[]): void {
    if (this._isUnusable()) return

    if (this._isSameWorkingSet(ships)) {
      for (const ship of ships) {
        const index = this._indexByMmsi.get(ship.mmsi)
        if (index === undefined) continue
        this._storeState(index, ship)
        const billboard = this._billboards.get(index)
        billboard.color = TYPE_COLORS[ship.shipType]
        Cartesian3.fromDegrees(ship.lonDeg, ship.latDeg, 0, undefined, scratchPosition)
        billboard.position = scratchPosition
        billboard.show = ship.mmsi !== this._selectedMmsi
      }
      this._rotationsDirty = true
      return
    }

    // Rebuild for a materially different set.
    const billboards = this._billboards
    billboards.removeAll()
    this._indexByMmsi.clear()
    const n = ships.length
    this._lat0 = new Float64Array(n)
    this._lon0 = new Float64Array(n)
    this._vLat = new Float64Array(n)
    this._vLon = new Float64Array(n)
    this._tsMs = new Float64Array(n)
    this._cogRad = new Float64Array(n)
    const sprite = shipIcon()
    for (let i = 0; i < n; i++) {
      const ship = ships[i]
      this._storeState(i, ship)
      Cartesian3.fromDegrees(ship.lonDeg, ship.latDeg, 0, undefined, scratchPosition)
      const billboard = billboards.add({
        id: ship.mmsi,
        position: scratchPosition,
        color: TYPE_COLORS[ship.shipType],
        scaleByDistance: SCALE_BY_DISTANCE,
        show: ship.mmsi !== this._selectedMmsi,
      })
      // Fixed image id → one shared atlas entry for the whole fleet.
      billboard.setImage(SHIP_IMAGE_ID, sprite)
      this._indexByMmsi.set(ship.mmsi, i)
    }
    this._rotationsDirty = true
    if (this._selectedMmsi !== null && !this._indexByMmsi.has(this._selectedMmsi)) {
      this._selectedMmsi = null
    }
  }

  /**
   * Dead-reckon every moving vessel to wall-clock `wallNowMs`, and refresh
   * hull rotations when the camera heading (or the data set) changed. The
   * position pass is a no-op unless at least 250 ms elapsed since the last
   * one; the rotation pass has its own gate (see HEADING_EPSILON_RAD) and
   * runs outside the interval gate so the fleet re-orients promptly while
   * the camera spins. Zero allocations: one shared scratch Cartesian3.
   */
  advance(wallNowMs: number): void {
    if (this._isUnusable()) return

    const headingRad = this._scene.camera.heading
    if (
      Number.isFinite(headingRad) &&
      (this._rotationsDirty ||
        Math.abs(headingRad - this._lastAppliedHeadingRad) > HEADING_EPSILON_RAD)
    ) {
      this._refreshRotations(headingRad)
    }

    if (wallNowMs - this._lastAdvanceMs < MIN_ADVANCE_INTERVAL_MS) return
    this._lastAdvanceMs = wallNowMs

    const billboards = this._billboards
    const count = Math.min(billboards.length, this._lat0.length)
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
      billboards.get(i).position = scratchPosition
    }
  }

  /**
   * Point every moving hull along its course. Billboard rotation is
   * counterclockwise in screen space (alignedAxis ZERO) while COG is
   * clockwise from north, and the camera heading rotates the whole screen —
   * hence rotation = -cogRad - headingRad. Moored vessels (sog < 0.2 kn,
   * encoded as zero velocity) are skipped: their COG is noise, so they keep
   * whatever rotation they last had. Billboard's rotation setter no-ops on
   * unchanged values, so re-running this pass is cheap when little moved.
   */
  private _refreshRotations(headingRad: number): void {
    const billboards = this._billboards
    const count = Math.min(billboards.length, this._cogRad.length)
    for (let i = 0; i < count; i++) {
      if (this._vLat[i] === 0 && this._vLon[i] === 0) continue
      billboards.get(i).rotation = -this._cogRad[i] - headingRad
    }
    this._lastAppliedHeadingRad = headingRad
    this._rotationsDirty = false
  }

  /**
   * Mark one vessel (or none) as selected. Its layer billboard is hidden — a
   * separate marker represents it. Unlike ConstellationLayer, the previous
   * billboard is re-shown here explicitly: advance() skips moored ships, so
   * a once-selected stationary vessel would otherwise stay hidden forever.
   */
  setSelected(mmsi: number | null): void {
    if (this._isUnusable()) return
    if (mmsi === this._selectedMmsi) return
    const previous = this._selectedMmsi
    this._selectedMmsi = mmsi
    if (previous !== null) {
      const billboard = this._billboardFor(previous)
      if (billboard !== undefined) billboard.show = true
    }
    if (mmsi !== null) {
      const billboard = this._billboardFor(mmsi)
      if (billboard !== undefined) billboard.show = false
    }
  }

  /**
   * Returns the MMSI under the cursor if the picked primitive belongs to
   * this collection, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): number | null {
    if (scene.isDestroyed() || this._billboards.isDestroyed()) return null
    // Scene.pick returns { primitive, collection, id } for billboards
    // (Billboard.getPickId; verified in cesium 1.138).
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      picked.collection === this._billboards &&
      typeof picked.id === 'number'
    ) {
      return picked.id
    }
    return null
  }

  /** Show or hide the whole layer (billboards keep updating while hidden). */
  setVisible(visible: boolean): void {
    if (this._isUnusable()) return
    this._billboards.show = visible
  }

  dispose(): void {
    this._indexByMmsi.clear()
    this._selectedMmsi = null
    if (this._billboards.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._billboards)
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
   * Record the report, the course (for the rotation pass), and the
   * precomputed surface velocity in degrees/second (equirectangular:
   * dLat = v·cos(brg)/111320, dLon = v·sin(brg)/(111320·cos(lat)))
   * so advance() does no trigonometry.
   */
  private _storeState(index: number, ship: Ship): void {
    this._lat0[index] = ship.latDeg
    this._lon0[index] = ship.lonDeg
    this._tsMs[index] = ship.tsMs
    const bearingRad = ship.cogDeg * RAD_PER_DEG
    this._cogRad[index] = bearingRad
    if (ship.sogKn < MOORED_SOG_KN) {
      this._vLat[index] = 0
      this._vLon[index] = 0
      return
    }
    const speedMs = ship.sogKn * KNOTS_TO_MS
    const cosLat = Math.max(Math.cos(ship.latDeg * RAD_PER_DEG), MIN_COS_LAT)
    this._vLat[index] = (speedMs * Math.cos(bearingRad)) / METERS_PER_DEG
    this._vLon[index] = (speedMs * Math.sin(bearingRad)) / (METERS_PER_DEG * cosLat)
  }

  private _isUnusable(): boolean {
    return this._billboards.isDestroyed() || this._scene.isDestroyed()
  }

  private _billboardFor(mmsi: number): Billboard | undefined {
    const index = this._indexByMmsi.get(mmsi)
    if (index === undefined || index >= this._billboards.length) return undefined
    return this._billboards.get(index)
  }
}
