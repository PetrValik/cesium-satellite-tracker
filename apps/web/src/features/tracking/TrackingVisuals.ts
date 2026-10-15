import {
  ArcType,
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
} from 'cesium'
import type { Entity, Viewer } from 'cesium'
import { satelliteIcon } from '../../core/engine/icons'
import { SIGNAL_AMBER, SIGNAL_CYAN } from '../../core/engine/signalColors'
import { footprintRadiusM, rotateEciKmToEcefM, type SatStateEcef } from '../../lib/orbital'

// The selection is always signal amber — like the ship/aircraft decals — and
// never the satellite's orbit-class palette hue: amber is what marks "the
// one you picked" in every domain.
const ORBIT_COLOR = Color.fromCssColorString(SIGNAL_AMBER).withAlpha(0.8)
const GROUND_TRACK_COLOR = Color.fromCssColorString(SIGNAL_CYAN).withAlpha(0.6)
const MARKER_COLOR = Color.fromCssColorString(SIGNAL_AMBER)
/**
 * The ground track floats slightly above the ellipsoid: enough to never
 * z-fight the globe surface, far too little to read as "in orbit" (the
 * tracked satellites fly hundreds of km up).
 */
const GROUND_TRACK_HEIGHT_M = 10_000
const FOOTPRINT_FILL = Color.fromCssColorString(SIGNAL_AMBER).withAlpha(0.06)
const FOOTPRINT_OUTLINE = Color.fromCssColorString(SIGNAL_AMBER).withAlpha(0.35)
/** Up-right of the marker (screen space: +x right, -y up). */
const LABEL_OFFSET = new Cartesian2(12, -12)

// Scratch for the sub-satellite point computation in updateLive (per tick,
// must not allocate).
const scratchCartographic = new Cartographic()

/** The `id` of a Scene.pick/drillPick result — the entity, for entity-backed visuals. */
function pickedEntity(picked: unknown): unknown {
  return typeof picked === 'object' && picked !== null
    ? (picked as { id?: unknown }).id
    : undefined
}

/**
 * Visuals for the single tracked satellite: orbit polyline, ground track,
 * live marker + label, and ground footprint circle. A handful of objects, so
 * entities are fine here — but they are created once and mutated, never
 * recreated per frame. The per-tick hot path (updateLive) only writes into
 * plain fields that CallbackProperty/CallbackPositionProperty instances read
 * back each render, which keeps it allocation-free on our side.
 */
export class TrackingVisuals {
  private readonly _viewer: Viewer
  private readonly _orbit: Entity
  private readonly _marker: Entity
  private readonly _footprint: Entity
  private readonly _ground: Entity
  /** Sliding-window ground track positions, mutated in place by setGroundTrack. */
  private _groundPositions: Cartesian3[] = []

  // Live state read by the callback properties each frame.
  private readonly _livePosition = new Cartesian3()
  private readonly _footprintCenter = new Cartesian3()
  private _footprintRadiusM = 1
  private readonly _labelText = new ConstantProperty('')

  // Orbit ring: sampled once in ECI km, rotated into ECEF by the current GMST
  // on demand — the closed ring turns with the sky while Earth rotates under
  // it, and the satellite rides exactly on it.
  private _ringEciKm: Float64Array | null = null
  private _ringPositions: Cartesian3[] = []
  private _liveGmst = 0
  private _ringGmst = Number.NaN

  constructor(viewer: Viewer) {
    this._viewer = viewer

    this._orbit = viewer.entities.add({
      show: false,
      polyline: {
        // Dynamic positions: re-evaluated per frame, refreshed only when
        // GMST actually moved (see _refreshRing).
        positions: new CallbackProperty(() => {
          this._refreshRing()
          return this._ringPositions
        }, false),
        width: 1.5,
        material: ORBIT_COLOR,
        // Samples are already dense 3D points — no arc interpolation.
        arcType: ArcType.NONE,
      },
    })

    this._marker = viewer.entities.add({
      show: false,
      // Dynamic position evaluated per frame from _livePosition; cloning into
      // the provided `result` keeps the callback allocation-free.
      position: new CallbackPositionProperty(
        (_time, result) => Cartesian3.clone(this._livePosition, result),
        false,
      ),
      // Selected-satellite marker: the shared satellite sprite (64 px canvas,
      // BillboardGraphics.image accepts it directly), amber-tinted. Fixed
      // scale 0.5 ≈ 32 px — this is the one satellite the user is inspecting,
      // so no distance scaling.
      billboard: {
        image: satelliteIcon(),
        color: MARKER_COLOR,
        scale: 0.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: this._labelText,
        font: '12px monospace',
        fillColor: Color.WHITE,
        pixelOffset: LABEL_OFFSET,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    this._ground = viewer.entities.add({
      show: false,
      polyline: {
        // Dynamic positions: the window slides with sim time (setGroundTrack).
        // 3D Cartesian points, so the antimeridian needs no special casing.
        positions: new CallbackProperty(() => this._groundPositions, false),
        width: 1,
        material: GROUND_TRACK_COLOR,
        // Straight chords between samples: at 128 samples per revolution a
        // chord dips only ~2 km below the surface arc, well inside the 10 km
        // float height — and unlike GEODESIC it costs no per-frame
        // re-tessellation on a dynamic polyline.
        arcType: ArcType.NONE,
      },
    })

    this._footprint = viewer.entities.add({
      show: false,
      position: new CallbackPositionProperty(
        (_time, result) => Cartesian3.clone(this._footprintCenter, result),
        false,
      ),
      ellipse: {
        // isConstant=false marks the geometry dynamic — the right mode for a
        // shape that moves every tick (constant properties mutated per tick
        // would thrash the async geometry batcher instead).
        semiMajorAxis: new CallbackProperty(() => this._footprintRadiusM, false),
        semiMinorAxis: new CallbackProperty(() => this._footprintRadiusM, false),
        // Slightly above the surface: with globe.depthTestAgainstTerrain on,
        // a height-0 disk z-fights the globe. 5 km is invisible at footprint
        // scale (thousands of km across).
        height: 5_000,
        material: FOOTPRINT_FILL,
        outline: true,
        outlineColor: FOOTPRINT_OUTLINE,
      },
    })
  }

  /**
   * Install the orbit ring for the selected satellite: one closed revolution
   * in ECI kilometers (last sample repeating the first), rotated by GMST at
   * render time.
   */
  setOrbitRing(ringEciKm: Float64Array): void {
    if (this._isUnusable()) return
    const usable =
      ringEciKm.length >= 6 && ringEciKm.length % 3 === 0 && Number.isFinite(ringEciKm[0])
    if (usable) {
      this._ringEciKm = ringEciKm
      const n = ringEciKm.length / 3
      if (this._ringPositions.length !== n) {
        this._ringPositions = Array.from({ length: n }, () => new Cartesian3())
      }
      this._ringGmst = Number.NaN // force refresh on next evaluation
      this._orbit.show = true
    } else {
      this._ringEciKm = null
      this._orbit.show = false
    }
  }

  /**
   * Replace the ground-track window: [lonDeg, latDeg] pairs. Called every
   * frame with GroundTrackWindow's sliding window, so the trail recedes
   * behind the satellite while new path grows ahead. Mutates the position
   * pool in place; the dynamic polyline picks the change up on its next
   * evaluation.
   */
  setGroundTrack(track: Float64Array): void {
    if (this._isUnusable()) return
    let count = 0
    for (let i = 0; i + 1 < track.length; i += 2) {
      const lon = track[i]
      const lat = track[i + 1]
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      if (count === this._groundPositions.length) this._groundPositions.push(new Cartesian3())
      Cartesian3.fromDegrees(lon, lat, GROUND_TRACK_HEIGHT_M, undefined, this._groundPositions[count])
      count++
    }
    this._groundPositions.length = count
    this._ground.show = count >= 2
  }

  /**
   * Rotate the ECI ring into ECEF meters for the current GMST, in place. The
   * frame and unit math (rotation about +Z, km→m) is lib/orbital's — this
   * class never scales or rotates a position itself.
   */
  private _refreshRing(): void {
    const eci = this._ringEciKm
    if (eci === null || this._ringGmst === this._liveGmst) return
    this._ringGmst = this._liveGmst
    rotateEciKmToEcefM(eci, this._liveGmst, this._ringPositions)
  }

  /**
   * Per-frame update of the live marker, label, footprint, and the GMST used
   * to orient the orbit ring, from the caller's reused propagation state
   * (`propagateEcef(…, out)`) — nothing is allocated on either side. A
   * non-positive footprint radius (lib/orbital.footprintRadiusM) hides the
   * footprint.
   */
  updateLive(state: Readonly<SatStateEcef>, name: string): void {
    if (this._isUnusable()) return

    this._liveGmst = state.gmstRad
    const p = state.positionEcefM
    this._livePosition.x = p[0]
    this._livePosition.y = p[1]
    this._livePosition.z = p[2]
    this._marker.show = true
    // ConstantProperty.setValue no-ops when the string is unchanged.
    this._labelText.setValue(name)

    // Sub-satellite point: geodetic projection of the ECEF position onto the
    // ellipsoid at height 0.
    const carto = Cartographic.fromCartesian(this._livePosition, undefined, scratchCartographic)
    const radius = footprintRadiusM(state.altKm)
    if (carto !== undefined && radius > 0) {
      Cartesian3.fromRadians(carto.longitude, carto.latitude, 0, undefined, this._footprintCenter)
      this._footprintRadiusM = radius
      this._footprint.show = true
    } else {
      // Keep the last positive radius so the (hidden) dynamic ellipse never
      // evaluates with degenerate axes.
      this._footprint.show = false
    }
  }

  /**
   * True when a Scene.pick/drillPick result is the live marker billboard or
   * its label — i.e. a tap on the selected satellite itself. Entity
   * billboards/labels carry the entity as their pick `id`
   * (BillboardVisualizer/LabelVisualizer, cesium 1.138). The orbit ring and
   * ground track are NOT claimed here: a tap on them is "near", not "on",
   * the satellite — see ownsThinDecoration.
   */
  ownsMarker(picked: unknown): boolean {
    return pickedEntity(picked) === this._marker
  }

  /**
   * True when a pick result is the orbit ring or the ground track: thin lines
   * hugging the selection, so a tap on one is a near-miss that keeps it.
   * Their dynamic entity polylines are PolylineCollection lines whose pick
   * object carries the entity as `id` (PolylineGeometryUpdater
   * DynamicGeometryUpdater + Polyline.getPickId, cesium 1.138). The footprint
   * is deliberately NOT included: its fill covers a wide area around the
   * satellite, and a tap inside it must still read as an empty tap.
   */
  ownsThinDecoration(picked: unknown): boolean {
    const entity = pickedEntity(picked)
    return entity !== undefined && (entity === this._orbit || entity === this._ground)
  }

  /** Hide everything (deselect). Visual entities are kept for reuse. */
  clear(): void {
    if (this._isUnusable()) return
    this._ringEciKm = null
    this._groundPositions.length = 0
    this._orbit.show = false
    this._ground.show = false
    this._marker.show = false
    this._footprint.show = false
  }

  dispose(): void {
    if (this._viewer.isDestroyed()) return
    const entities = this._viewer.entities
    entities.remove(this._orbit)
    entities.remove(this._ground)
    entities.remove(this._marker)
    entities.remove(this._footprint)
  }

  private _isUnusable(): boolean {
    return this._viewer.isDestroyed()
  }
}
