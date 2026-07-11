import { BillboardCollection, BlendOption, Cartesian3, Color, NearFarScalar } from 'cesium'
import type { Billboard, Cartesian2, Scene } from 'cesium'
import { aircraftIcon } from '../../core/engine/icons'
import type { Aircraft } from '@orbital-ops/shared'
import { categoryOf } from './aircraftCategory'

/** On-ground aircraft render flat grey regardless of the category hue. */
const COLOR_GROUND = Color.fromCssColorString('#8a93a3').withAlpha(0.95)

/** Altitude drives the shade of the category hue: darker low, full bright high. */
const BAND_SHADE = { low: 0.55, mid: 0.78, high: 1.0 } as const

export type AircraftPalette = Record<'civil' | 'cargo' | 'military', string>

/** Precomputed tint per category x altitude band. */
type ShadedPalette = Record<keyof AircraftPalette, { low: Color; mid: Color; high: Color }>

function shade(hex: string, factor: number): Color {
  const c = Color.fromCssColorString(hex)
  return new Color(c.red * factor, c.green * factor, c.blue * factor, 0.95)
}

function buildShadedPalette(palette: AircraftPalette): ShadedPalette {
  const out = {} as ShadedPalette
  for (const key of ['civil', 'cargo', 'military'] as const) {
    out[key] = {
      low: shade(palette[key], BAND_SHADE.low),
      mid: shade(palette[key], BAND_SHADE.mid),
      high: shade(palette[key], BAND_SHADE.high),
    }
  }
  return out
}

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
 * Camera-ward eye offset: with scene.globe.depthTestAgainstTerrain enabled,
 * near-surface billboards (taxiing and low-flying aircraft) half-sink into
 * the terrain and z-fight at grazing angles. Eye coordinates are left-handed
 * with +z pointing INTO the screen (Billboard.eyeOffset docs, cesium 1.138),
 * so negative z pulls the sprite 1 km toward the viewer — imperceptible at
 * aircraft-viewing distances, but decisively in front of the terrain depth.
 * Shared instance: the Billboard constructor clones it (Cartesian3.clone in
 * cesium 1.138) and we never mutate it.
 */
const EYE_OFFSET = new Cartesian3(0, 0, -1000)

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

/**
 * Color for a state vector (chosen at set time, not re-derived per frame):
 * hue from the heuristic category, shade from the altitude band — so the
 * filter toggles never change what a color means.
 */
function colorFor(aircraft: Aircraft, palette: ShadedPalette): Color {
  if (aircraft.onGround) return COLOR_GROUND
  const shades = palette[categoryOf(aircraft)]
  const altM = aircraft.altM ?? 0
  if (altM < 3000) return shades.low
  if (altM <= 9000) return shades.mid
  return shades.high
}

/**
 * The ADS-B aircraft layer: one BillboardCollection, one tinted airliner
 * sprite per aircraft, keyed by ICAO 24-bit address. Between feed polls
 * `advance()` dead-reckons every aircraft with a usable velocity/track along
 * its track (cheap equirectangular step) plus vertical rate on altitude,
 * gated to at most once per 250 ms and clamped to 15 minutes of
 * extrapolation. Each glyph carries a FIXED screen rotation by its reported
 * track, set once per feed snapshot — moving the camera never re-orients an
 * icon (explicit user preference over world-projected orientation, which
 * visibly spins while orbiting a followed aircraft). Null-track aircraft
 * render upright. The selected aircraft's billboard is hidden — a dedicated
 * marker elsewhere represents it.
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
  private _palette: ShadedPalette = buildShadedPalette({
    civil: '#4da6ff',
    cargo: '#f87171',
    military: '#7dd87d',
  })

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
   * Rotation is set here, at store time only: dead reckoning never
   * changes the track, so advance() carries no orientation work at all.
   */
  setAircraft(aircraft: Aircraft[]): void {
    if (this._isUnusable()) return

    if (this._isSameWorkingSet(aircraft)) {
      for (const state of aircraft) {
        const index = this._indexByIcao24.get(state.icao24)
        if (index === undefined) continue
        this._storeState(index, state)
        const billboard = this._billboards.get(index)
        billboard.color = colorFor(state, this._palette)
        Cartesian3.fromDegrees(
          state.lonDeg,
          state.latDeg,
          state.altM ?? 0,
          undefined,
          scratchPosition,
        )
        billboard.position = scratchPosition
        // No reported track → ZERO means plain screen-aligned.
        billboard.rotation = state.trackDeg === null ? 0 : -state.trackDeg * RAD_PER_DEG
        billboard.show = state.icao24 !== this._selectedIcao24
      }
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
        color: colorFor(state, this._palette),
        scaleByDistance: SCALE_BY_DISTANCE,
        // No reported track → ZERO means plain screen-aligned.
        rotation: state.trackDeg === null ? 0 : -state.trackDeg * RAD_PER_DEG,
        eyeOffset: EYE_OFFSET,
        show: state.icao24 !== this._selectedIcao24,
      })
      // Fixed image id → one shared atlas entry for the whole picture.
      billboard.setImage(AIRCRAFT_IMAGE_ID, sprite)
      this._indexByIcao24.set(state.icao24, i)
    }
    if (this._selectedIcao24 !== null && !this._indexByIcao24.has(this._selectedIcao24)) {
      this._selectedIcao24 = null
    }
  }

  /**
   * Dead-reckon every reckonable aircraft to wall-clock `wallNowMs`. No-op
   * unless at least 250 ms elapsed since the last pass; extrapolation is
   * clamped to 15 minutes past the state vector. Orientation costs nothing
   * here: rotation is fixed at store time, and
   * Cesium re-projects it to the screen every frame on its own. Zero
   * allocations: one shared scratch Cartesian3 is reused for every
   * billboard.
   */
  advance(wallNowMs: number): void {
    if (this._isUnusable()) return
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
  /**
   * Swap the category hues (user palette). Colors are applied at set time,
   * so the caller re-feeds the current working set after switching.
   */
  setPalette(palette: AircraftPalette): void {
    this._palette = buildShadedPalette(palette)
  }

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
   * Record the state vector and the precomputed surface velocity in
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
    return this._billboards.isDestroyed() || this._scene.isDestroyed()
  }

  private _billboardFor(icao24: string): Billboard | undefined {
    const index = this._indexByIcao24.get(icao24)
    if (index === undefined || index >= this._billboards.length) return undefined
    return this._billboards.get(index)
  }
}
