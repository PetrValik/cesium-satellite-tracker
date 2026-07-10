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

const ORBIT_COLOR = Color.fromCssColorString('#ffb454').withAlpha(0.8) // signal amber
const GROUND_TRACK_COLOR = Color.fromCssColorString('#6ee7ff').withAlpha(0.6) // cyan
const MARKER_COLOR = Color.fromCssColorString('#ffb454')
const FOOTPRINT_FILL = Color.fromCssColorString('#ffb454').withAlpha(0.06)
const FOOTPRINT_OUTLINE = Color.fromCssColorString('#ffb454').withAlpha(0.35)
/** Up-right of the marker (screen space: +x right, -y up). */
const LABEL_OFFSET = new Cartesian2(12, -12)

// Scratch for the sub-satellite point computation in updateLive (per tick,
// must not allocate).
const scratchCartographic = new Cartographic()

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
  /** One polyline entity per antimeridian-split segment; rebuilt per setTrack. */
  private readonly _groundSegments: Entity[] = []

  // Live state read by the callback properties each frame.
  private readonly _livePosition = new Cartesian3()
  private readonly _footprintCenter = new Cartesian3()
  private _footprintRadiusM = 1
  private readonly _labelText = new ConstantProperty('')

  constructor(viewer: Viewer) {
    this._viewer = viewer

    this._orbit = viewer.entities.add({
      show: false,
      polyline: {
        // positions assigned in setTrack()
        width: 1.5,
        material: ORBIT_COLOR,
        // Samples are already dense 3D ECEF points — no arc interpolation.
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
      point: {
        pixelSize: 8,
        color: MARKER_COLOR,
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
        height: 0,
        material: FOOTPRINT_FILL,
        outline: true,
        outlineColor: FOOTPRINT_OUTLINE,
      },
    })
  }

  /**
   * Install the precomputed track for the selected satellite.
   * orbitEcef: [x,y,z,...] ECEF meters over one orbital period.
   * groundTrack: [lonDeg,latDeg,...] pairs over the same window.
   */
  setTrack(payload: { orbitEcef: Float64Array; groundTrack: Float64Array }): void {
    if (this._isUnusable()) return

    const { orbitEcef } = payload
    if (orbitEcef.length >= 6 && orbitEcef.length % 3 === 0 && this._orbit.polyline) {
      // Cartesian3.unpackArray is typed for number[], but at runtime it only
      // reads `.length` and numeric indices, so a Float64Array works as-is.
      const positions = Cartesian3.unpackArray(orbitEcef as unknown as number[])
      this._orbit.polyline.positions = new ConstantProperty(positions)
      this._orbit.show = true
    } else {
      this._orbit.show = false
    }

    this._rebuildGroundTrack(payload.groundTrack)
  }

  /**
   * Per-tick update of the live marker, label, and ground footprint.
   * positionEcefM: ECEF meters. footprintRadiusM <= 0 hides the footprint.
   */
  updateLive(payload: {
    positionEcefM: [number, number, number]
    footprintRadiusM: number
    name: string
  }): void {
    if (this._isUnusable()) return

    const p = payload.positionEcefM
    this._livePosition.x = p[0]
    this._livePosition.y = p[1]
    this._livePosition.z = p[2]
    this._marker.show = true
    // ConstantProperty.setValue no-ops when the string is unchanged.
    this._labelText.setValue(payload.name)

    // Sub-satellite point: geodetic projection of the ECEF position onto the
    // ellipsoid at height 0.
    const carto = Cartographic.fromCartesian(this._livePosition, undefined, scratchCartographic)
    const radius = payload.footprintRadiusM
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

  /** Hide everything (deselect). Visual entities are kept for reuse. */
  clear(): void {
    if (this._isUnusable()) return
    this._orbit.show = false
    this._marker.show = false
    this._footprint.show = false
    this._removeGroundSegments()
  }

  dispose(): void {
    if (this._viewer.isDestroyed()) {
      this._groundSegments.length = 0
      return
    }
    this._removeGroundSegments()
    const entities = this._viewer.entities
    entities.remove(this._orbit)
    entities.remove(this._marker)
    entities.remove(this._footprint)
  }

  private _isUnusable(): boolean {
    return this._viewer.isDestroyed()
  }

  private _rebuildGroundTrack(track: Float64Array): void {
    this._removeGroundSegments()

    // Split at the antimeridian: a longitude jump of more than 180° between
    // consecutive samples means the track wrapped, and a single polyline
    // would smear across the whole map.
    let segment: Cartesian3[] = []
    let prevLon = Number.NaN
    for (let i = 0; i + 1 < track.length; i += 2) {
      const lon = track[i]
      const lat = track[i + 1]
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      if (!Number.isNaN(prevLon) && Math.abs(lon - prevLon) > 180) {
        this._addGroundSegment(segment)
        segment = []
      }
      segment.push(Cartesian3.fromDegrees(lon, lat, 0))
      prevLon = lon
    }
    this._addGroundSegment(segment)
  }

  private _addGroundSegment(positions: Cartesian3[]): void {
    if (positions.length < 2) return
    this._groundSegments.push(
      this._viewer.entities.add({
        polyline: {
          positions,
          width: 1,
          material: GROUND_TRACK_COLOR,
          clampToGround: true,
        },
      }),
    )
  }

  private _removeGroundSegments(): void {
    const entities = this._viewer.entities
    for (const segment of this._groundSegments) {
      entities.remove(segment)
    }
    this._groundSegments.length = 0
  }
}
