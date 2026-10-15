import { BillboardCollection, BlendOption, Cartesian3, Color, NearFarScalar } from 'cesium'
import type { Billboard, Scene } from 'cesium'
import { satelliteIcon } from '../../core/engine/icons'
import { DEFAULT_COLORS, type ColorPrefs } from '../../core/ui/prefsStore'
import { ORBIT_CLASSES, type OrbitClass } from '../../lib/protocol'
import { interpolateInto, isOccluded } from './snapshotMath'

interface ClassStyle {
  /** Slightly translucent tint multiplied into the white sprite. */
  color: Color
  scaleByDistance: NearFarScalar
}

/**
 * Distance scaling math: the sprite is 64 px square and Billboard.scale
 * multiplies the image size, so a target pixel size maps to
 * scale = targetPx / 64. NearFarScalar lerps that scale by camera distance:
 *  - near 4e5 m (~LEO altitude — camera riding alongside a satellite):
 *    28 / 64 = 0.4375 → a ~28 px icon whose glyph is recognizable;
 *  - far 4e7 m (~whole-globe camera range): the old per-class dot sizes
 *    (1.5–2.5 px) / 64 → from orbit the catalog stays a starfield of dots.
 */
const SPRITE_PX = 64
const ICON_NEAR_M = 4e5
const ICON_NEAR_PX = 28
const ICON_FAR_M = 4e7

type SatellitePalette = ColorPrefs['satellites']

/** Far dot size per class keeps the original pixelSize hierarchy. */
const FAR_DOT_PX: Record<OrbitClass, number> = { LEO: 1.5, MEO: 2.0, GEO: 2.5, HEO: 2.0 }

/** Indexed by the class byte from the worker; protocol order is authoritative. */
function buildStyles(palette: SatellitePalette): readonly ClassStyle[] {
  return ORBIT_CLASSES.map((c) => ({
    color: Color.fromCssColorString(palette[c]).withAlpha(0.9),
    scaleByDistance: new NearFarScalar(
      ICON_NEAR_M,
      ICON_NEAR_PX / SPRITE_PX,
      ICON_FAR_M,
      FAR_DOT_PX[c] / SPRITE_PX,
    ),
  }))
}

/**
 * One fixed atlas id shared by the whole catalog. Billboard.setImage(id, …)
 * routes through the collection's id-keyed texture cache, so every billboard
 * resolves to the SAME atlas entry — passing the canvas as `image:` in add()
 * would mint a fresh GUID per billboard and flood the atlas with 12k+ copies
 * (verified in cesium 1.138 Billboard._computeImageTextureProperties).
 */
const SATELLITE_IMAGE_ID = 'icon:satellite'

// Module-scope scratch: advance() runs every frame for thousands of
// billboards and must not allocate.
const scratchPosition = new Cartesian3()

/**
 * Extrapolation bounds for the interpolation parameter: slightly outside the
 * sample pair is fine (slerp continues along the same arc while the next
 * worker tick is in flight), but far outside would swing points wildly.
 */
const T_MIN = -1
const T_MAX = 2

/**
 * The whole-catalog satellite layer: one BillboardCollection, one tinted
 * satellite sprite per satellite. The worker delivers position snapshots at
 * 1–4 Hz; between snapshots `advance()` interpolates every billboard each
 * frame along the sphere (slerp on direction, lerp on radius) — orbits are
 * near-circular, so the spherical arc between two samples closely follows
 * the true path and the constellation moves smoothly even under heavy time
 * warp. The selected satellite is rendered by TrackingVisuals (exact,
 * per-frame), so its billboard here is hidden.
 *
 * Perf: BillboardCollection batches the whole collection into shared vertex
 * buffers and issues one draw per render pass against the shared texture
 * atlas (verified in cesium 1.138 BillboardCollection.js). With the single
 * shared sprite the atlas holds ONE entry, so 12k+ satellites cost one
 * translucent draw call.
 */
export class ConstellationLayer {
  private readonly _scene: Scene
  private readonly _billboards: BillboardCollection
  private readonly _indexByNoradId = new Map<number, number>()
  private _selectedNoradId: number | null = null
  private _visible = true
  private _styles: readonly ClassStyle[] = buildStyles(DEFAULT_COLORS.satellites)
  /** Class byte per billboard (kept for palette swaps). */
  private _classes = new Uint8Array(0)

  // Two most recent worker snapshots; advance() interpolates between them.
  private _prevPositions: Float32Array | null = null
  private _prevEpochMs = 0
  private _currPositions: Float32Array | null = null
  private _currEpochMs = 0

  constructor(scene: Scene) {
    this._scene = scene
    this._billboards = new BillboardCollection({
      // Every instance is tinted with alpha < 1 and the sprite has soft
      // edges, so nothing renders opaque: TRANSLUCENT skips the opaque pass
      // entirely (depth test stays on — satellites still hide behind the
      // globe) and halves the draw work versus OPAQUE_AND_TRANSLUCENT.
      blendOption: BlendOption.TRANSLUCENT,
    })
    scene.primitives.add(this._billboards)
  }

  /**
   * Rebuild the layer for a new working set. `noradIds[i]` and `classes[i]`
   * describe the satellite whose position arrives at `positions[3i..3i+2]`.
   */
  setCatalog(noradIds: number[], classes: Uint8Array): void {
    if (this._isUnusable()) return
    const billboards = this._billboards
    billboards.removeAll()
    this._indexByNoradId.clear()
    this._selectedNoradId = null
    this._prevPositions = null
    this._currPositions = null
    // Own copy: the caller may reuse or transfer its buffer.
    this._classes = classes.slice()
    const sprite = satelliteIcon()
    for (let i = 0; i < noradIds.length; i++) {
      const style = this._styles[classes[i]] ?? this._styles[0]
      const billboard = billboards.add({
        id: noradIds[i],
        position: Cartesian3.ZERO,
        color: style.color,
        scaleByDistance: style.scaleByDistance,
        // Hidden until the first tick delivers a real position.
        show: false,
      })
      // Fixed image id → one shared atlas entry for the entire catalog.
      billboard.setImage(SATELLITE_IMAGE_ID, sprite)
      this._indexByNoradId.set(noradIds[i], i)
    }
  }

  /**
   * Accept a worker snapshot for sim time `epochMs`. Layout
   * [x0,y0,z0, x1,y1,z1, ...] in catalog order, ECEF meters; a NaN triple
   * marks a failed propagation and hides the billboard. Rendering happens in
   * `advance()`; this only rotates the sample pair. The worker transfers a
   * fresh buffer per tick, so retaining the reference is safe.
   */
  updatePositions(positions: Float32Array, epochMs: number): void {
    if (this._currPositions !== null && this._currPositions.length === positions.length) {
      this._prevPositions = this._currPositions
      this._prevEpochMs = this._currEpochMs
    } else {
      this._prevPositions = null
    }
    this._currPositions = positions
    this._currEpochMs = epochMs
  }

  /** Forget the sample pair (sim time jumped; interpolating across it would sweep points). */
  onTimeJump(): void {
    this._prevPositions = null
  }

  /**
   * Per-frame render: place every billboard at sim time `simEpochMs` by
   * interpolating between the two latest snapshots. Zero allocations: one
   * shared scratch Cartesian3 is reused — safe because Billboard's
   * `position` setter clones the value into its internal Cartesian3
   * (Cartesian3.clone(value, this._position) in Scene/Billboard.js; verified
   * in cesium 1.138) and retains no reference to what we pass in.
   */
  advance(simEpochMs: number): void {
    if (this._isUnusable()) return
    // Hidden layer: the collection-level show flag already blanks every
    // billboard, so the per-satellite interpolation loop is pure waste.
    // Positions catch up on the first advance() after re-show.
    if (!this._visible) return
    const curr = this._currPositions
    if (curr === null) return
    const billboards = this._billboards
    const count = Math.min(billboards.length, (curr.length / 3) | 0)
    const selectedIndex =
      this._selectedNoradId === null
        ? -1
        : (this._indexByNoradId.get(this._selectedNoradId) ?? -1)

    // Camera position for the horizon-culling pre-test (once per call).
    const cam = this._scene.camera.positionWC
    const camX = cam.x
    const camY = cam.y
    const camZ = cam.z

    const prev = this._prevPositions
    const span = this._currEpochMs - this._prevEpochMs
    const interpolate = prev !== null && span !== 0
    let t = 0
    if (interpolate) {
      t = (simEpochMs - this._prevEpochMs) / span
      if (t < T_MIN) t = T_MIN
      else if (t > T_MAX) t = T_MAX
    }

    for (let i = 0; i < count; i++) {
      const billboard = billboards.get(i)
      const bx = curr[3 * i]
      const by = curr[3 * i + 1]
      const bz = curr[3 * i + 2]
      if (Number.isNaN(bx) || Number.isNaN(by) || Number.isNaN(bz)) {
        billboard.show = false
        continue
      }

      // Behind-the-globe satellites would be hidden by the depth test anyway;
      // skipping them here saves their slerp and the position write (~half
      // the catalog at any moment). Tested on the snapshot position — within
      // a few hundred km of the interpolated one, far inside the margin.
      if (isOccluded(camX, camY, camZ, bx, by, bz)) {
        billboard.show = false
        continue
      }

      if (interpolate) {
        interpolateInto(prev, curr, i, t, scratchPosition)
      } else {
        scratchPosition.x = bx
        scratchPosition.y = by
        scratchPosition.z = bz
      }
      billboard.position = scratchPosition
      billboard.show = i !== selectedIndex
    }
  }

  /** Swap the per-class hues and recolor the whole catalog in place. */
  setPalette(palette: SatellitePalette): void {
    this._styles = buildStyles(palette)
    if (this._isUnusable()) return
    const billboards = this._billboards
    const count = Math.min(billboards.length, this._classes.length)
    for (let i = 0; i < count; i++) {
      const style = this._styles[this._classes[i]] ?? this._styles[0]
      const billboard = billboards.get(i)
      billboard.color = style.color
      billboard.scaleByDistance = style.scaleByDistance
    }
  }

  /**
   * Show or hide the whole catalog. One collection-level flag rather than
   * 12k+ per-billboard writes: the per-billboard show bits keep encoding
   * occlusion/selection/NaN state underneath (see advance/setSelected), so
   * they must not be overwritten here and re-showing is O(1).
   */
  setVisible(visible: boolean): void {
    this._visible = visible
    if (this._isUnusable()) return
    this._billboards.show = visible
  }

  /**
   * Mark one satellite (or none) as selected. Its layer billboard is hidden —
   * TrackingVisuals draws the smooth per-frame marker in its place. The
   * previously selected billboard reappears on the next tick.
   */
  setSelected(noradId: number | null): void {
    if (this._isUnusable()) return
    if (noradId === this._selectedNoradId) return
    this._selectedNoradId = noradId
    if (noradId !== null) {
      const billboard = this._billboardFor(noradId)
      if (billboard !== undefined) billboard.show = false
    }
  }

  /**
   * Matcher for one Scene.pick/drillPick result: the noradId if it is a
   * billboard of this collection, else null. Pure — the host runs ONE pick
   * pass per tap and offers every hit to each layer's matcher. Billboard
   * pick objects are { primitive, collection, id } (Billboard.getPickId;
   * verified in cesium 1.138).
   */
  idOf(picked: unknown): number | null {
    if (typeof picked !== 'object' || picked === null) return null
    const { collection, id } = picked as { collection?: unknown; id?: unknown }
    return collection === this._billboards && typeof id === 'number' ? id : null
  }

  dispose(): void {
    this._indexByNoradId.clear()
    this._selectedNoradId = null
    if (this._billboards.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._billboards)
    }
  }

  private _isUnusable(): boolean {
    return this._billboards.isDestroyed() || this._scene.isDestroyed()
  }

  private _billboardFor(noradId: number): Billboard | undefined {
    const index = this._indexByNoradId.get(noradId)
    if (index === undefined || index >= this._billboards.length) return undefined
    return this._billboards.get(index)
  }
}
