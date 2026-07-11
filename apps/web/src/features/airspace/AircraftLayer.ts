import { BillboardCollection, BlendOption, Cartesian3, Color, NearFarScalar } from 'cesium'
import type { Billboard, Cartesian2, Scene } from 'cesium'
import { aircraftIcon } from '../../core/engine/icons'
import type { Aircraft } from '@orbital-ops/shared'

/** Altitude-band colors (0.95 alpha, mirrors tokens.css hues). */
const COLOR_GROUND = Color.fromCssColorString('#8a93a3').withAlpha(0.95) // slate
const COLOR_LOW = Color.fromCssColorString('#7dd87d').withAlpha(0.95) // green, < 3000 m
const COLOR_MID = Color.fromCssColorString('#6ee7ff').withAlpha(0.95) // cyan, 3000–9000 m
const COLOR_HIGH = Color.fromCssColorString('#f0f4f8').withAlpha(0.95) // near-white, above

/**
 * Distance scaling: the airliner sprite is 64 px and Billboard.scale
 * multiplies it, so targetPx / 64 is the scale. Same tuning as the ships
 * layer — aircraft cruise a dozen km up, well inside the near band:
 *  - within 8e4 m (~80 km): 28 / 64 → a ~28 px recognizable airliner;
 *  - beyond 6e6 m (pulling out toward globe view): 4 / 64 → a ~4 px dot.
 * Shared across all billboards; the Billboard constructor clones it
 * (NearFarScalar.clone in cesium 1.138) and we never mutate it.
 */
const SPRITE_PX = 64
const SCALE_BY_DISTANCE = new NearFarScalar(8e4, 28 / SPRITE_PX, 6e6, 4 / SPRITE_PX)

/** One fixed atlas id: every billboard shares the single airliner sprite entry. */
const AIRCRAFT_IMAGE_ID = 'icon:aircraft'

/**
 * Rotation refresh gate: rewriting Billboard.rotation dirties per-billboard
 * vertex data, and re-rotating thousands of billboards every frame while the
 * camera is still is pure waste. The rotation pass therefore only runs when
 * the camera heading has drifted more than this (~1.1°) since the last
 * applied pass, or when setAircraft changed the data set.
 */
const HEADING_EPSILON_RAD = 0.02

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

// Module-scope scratch: advance() runs over thousands of billboards and must
// not allocate. Safe to share because Billboard's `position` setter clones
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
 * The ADS-B aircraft layer: one BillboardCollection, one tinted airliner
 * sprite per aircraft, keyed by ICAO 24-bit address. Between feed polls
 * `advance()` dead-reckons every aircraft with a usable velocity/track along
 * its track (cheap equirectangular step) plus vertical rate on altitude,
 * gated to at most once per 250 ms and clamped to 15 minutes of
 * extrapolation. Each glyph is rotated to point along its reported track;
 * because billboards rotate in screen space, the rotation must compensate
 * the camera heading (rotation = -trackRad - camera.heading) and is
 * refreshed on a heading-gated pass. The selected aircraft's billboard is
 * hidden — a dedicated marker elsewhere represents it.
 *
 * Update strategy: when a poll delivers exactly the working set we already
 * hold (same ICAO set), billboards and dead-reckoning state are updated in
 * place; any add/remove churn triggers a wholesale rebuild. Rebuilds happen
 * at feed cadence (seconds), never per frame.
 */
export class AircraftLayer {
  private readonly _scene: Scene
  private readonly _billboards: BillboardCollection
  private readonly _indexByIcao24 = new Map<string, number>()
  private _selectedIcao24: string | null = null
  private _lastAdvanceMs = 0
  private _rotationsDirty = false
  /** Infinity → the first rotation pass always applies. */
  private _lastAppliedHeadingRad = Number.POSITIVE_INFINITY

  // Dead-reckoning state in billboard-index order. Positions are re-derived
  // from the *state vector* each pass (lat0 + vLat * dt), so the reckoning
  // never accumulates error and is idempotent across variable frame gaps.
  private _lat0 = new Float64Array(0) // reported latitude, degrees
  private _lon0 = new Float64Array(0) // reported longitude, degrees
  private _alt0 = new Float64Array(0) // reported altitude, metres (null → 0)
  private _vLat = new Float64Array(0) // deg/s northward (0 when not reckonable)
  private _vLon = new Float64Array(0) // deg/s eastward (0 when not reckonable)
  private _vAlt = new Float64Array(0) // m/s vertical (0 when not reckonable)
  private _tsMs = new Float64Array(0) // state-vector epoch, ms
  private _trackRad = new Float64Array(0) // track, radians CW from north (NaN = no track)

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
   * Accept the latest feed snapshot. Same ICAO set → in-place update of
   * positions/velocities/colors; otherwise the collection is rebuilt.
   * An empty array clears the layer. Selection survives either path (the
   * selected billboard stays hidden as long as its ICAO is present).
   * Rotations are (re)applied by the next advance() pass.
   */
  setAircraft(aircraft: Aircraft[]): void {
    if (this._isUnusable()) return

    if (this._isSameWorkingSet(aircraft)) {
      for (const state of aircraft) {
        const index = this._indexByIcao24.get(state.icao24)
        if (index === undefined) continue
        this._storeState(index, state)
        const billboard = this._billboards.get(index)
        billboard.color = colorFor(state)
        Cartesian3.fromDegrees(
          state.lonDeg,
          state.latDeg,
          state.altM ?? 0,
          undefined,
          scratchPosition,
        )
        billboard.position = scratchPosition
        billboard.show = state.icao24 !== this._selectedIcao24
      }
      this._rotationsDirty = true
      return
    }

    // Rebuild for a materially different set.
    const billboards = this._billboards
    billboards.removeAll()
    this._indexByIcao24.clear()
    const n = aircraft.length
    this._lat0 = new Float64Array(n)
    this._lon0 = new Float64Array(n)
    this._alt0 = new Float64Array(n)
    this._vLat = new Float64Array(n)
    this._vLon = new Float64Array(n)
    this._vAlt = new Float64Array(n)
    this._tsMs = new Float64Array(n)
    this._trackRad = new Float64Array(n)
    const sprite = aircraftIcon()
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
      const billboard = billboards.add({
        id: state.icao24,
        position: scratchPosition,
        color: colorFor(state),
        scaleByDistance: SCALE_BY_DISTANCE,
        show: state.icao24 !== this._selectedIcao24,
      })
      // Fixed image id → one shared atlas entry for the whole picture.
      billboard.setImage(AIRCRAFT_IMAGE_ID, sprite)
      this._indexByIcao24.set(state.icao24, i)
    }
    this._rotationsDirty = true
    if (this._selectedIcao24 !== null && !this._indexByIcao24.has(this._selectedIcao24)) {
      this._selectedIcao24 = null
    }
  }

  /**
   * Dead-reckon every reckonable aircraft to wall-clock `wallNowMs`, and
   * refresh glyph rotations when the camera heading (or the data set)
   * changed. The position pass is a no-op unless at least 250 ms elapsed
   * since the last one; extrapolation is clamped to 15 minutes past the
   * state vector. The rotation pass has its own gate (see
   * HEADING_EPSILON_RAD) and runs outside the interval gate so the picture
   * re-orients promptly while the camera spins. Zero allocations: one
   * shared scratch Cartesian3 is reused for every billboard.
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
      billboards.get(i).position = scratchPosition
    }
  }

  /**
   * Point every glyph along its reported track. Billboard rotation is
   * counterclockwise in screen space (alignedAxis ZERO) while track is
   * clockwise from north, and the camera heading rotates the whole screen —
   * hence rotation = -trackRad - headingRad. A null track (stored as NaN)
   * renders upright (rotation 0). Billboard's rotation setter no-ops on
   * unchanged values, so re-running this pass is cheap when little moved.
   */
  private _refreshRotations(headingRad: number): void {
    const billboards = this._billboards
    const count = Math.min(billboards.length, this._trackRad.length)
    for (let i = 0; i < count; i++) {
      const trackRad = this._trackRad[i]
      billboards.get(i).rotation = Number.isNaN(trackRad) ? 0 : -trackRad - headingRad
    }
    this._lastAppliedHeadingRad = headingRad
    this._rotationsDirty = false
  }

  /**
   * Mark one aircraft (or none) as selected. Its layer billboard is hidden —
   * a separate marker represents it. Unlike ConstellationLayer, the previous
   * billboard is re-shown here explicitly: advance() skips non-reckonable
   * aircraft, so a once-selected one would otherwise stay hidden forever.
   */
  setSelected(icao24: string | null): void {
    if (this._isUnusable()) return
    if (icao24 === this._selectedIcao24) return
    const previous = this._selectedIcao24
    this._selectedIcao24 = icao24
    if (previous !== null) {
      const billboard = this._billboardFor(previous)
      if (billboard !== undefined) billboard.show = true
    }
    if (icao24 !== null) {
      const billboard = this._billboardFor(icao24)
      if (billboard !== undefined) billboard.show = false
    }
  }

  /**
   * Returns the ICAO 24-bit address under the cursor if the picked primitive
   * belongs to this collection, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): string | null {
    if (scene.isDestroyed() || this._billboards.isDestroyed()) return null
    // Scene.pick returns { primitive, collection, id } for billboards
    // (Billboard.getPickId; verified in cesium 1.138).
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      picked.collection === this._billboards &&
      typeof picked.id === 'string'
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
    this._indexByIcao24.clear()
    this._selectedIcao24 = null
    if (this._billboards.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._billboards)
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
   * Record the state vector, the track (for the rotation pass; NaN when the
   * feed reports none), and the precomputed surface velocity in
   * degrees/second (equirectangular: dLat = v·cos(trk)/111320,
   * dLon = v·sin(trk)/(111320·cos(lat))) so advance() does no trigonometry.
   * Null velocity or track disables reckoning for this aircraft entirely.
   */
  private _storeState(index: number, aircraft: Aircraft): void {
    this._lat0[index] = aircraft.latDeg
    this._lon0[index] = aircraft.lonDeg
    this._alt0[index] = aircraft.altM ?? 0
    this._tsMs[index] = aircraft.tsMs
    this._trackRad[index] =
      aircraft.trackDeg === null ? Number.NaN : aircraft.trackDeg * RAD_PER_DEG
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
    return this._billboards.isDestroyed() || this._scene.isDestroyed()
  }

  private _billboardFor(icao24: string): Billboard | undefined {
    const index = this._indexByIcao24.get(icao24)
    if (index === undefined || index >= this._billboards.length) return undefined
    return this._billboards.get(index)
  }
}
