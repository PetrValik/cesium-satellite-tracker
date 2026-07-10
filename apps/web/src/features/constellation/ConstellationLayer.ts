import { Cartesian3, Color, PointPrimitiveCollection } from 'cesium'
import type { Cartesian2, PointPrimitive, Scene } from 'cesium'
import { ORBIT_CLASSES } from '../../lib/protocol'
import type { OrbitClass } from '../../lib/protocol'

interface ClassStyle {
  /** Slightly translucent fill used for the resting state. */
  color: Color
  /** Full-alpha fill used while the satellite is selected. */
  colorSolid: Color
  pixelSize: number
}

function makeStyle(css: string, pixelSize: number): ClassStyle {
  const solid = Color.fromCssColorString(css)
  return { color: solid.withAlpha(0.9), colorSolid: solid, pixelSize }
}

/** Design tokens per orbit class. */
const CLASS_STYLES: Record<OrbitClass, ClassStyle> = {
  LEO: makeStyle('#ffb454', 1.5), // signal amber
  MEO: makeStyle('#6ee7ff', 2.0), // cyan
  GEO: makeStyle('#c084fc', 2.5), // violet
  HEO: makeStyle('#f87171', 2.0), // red
}

/** Indexed by the class byte from the worker; protocol order is authoritative. */
const STYLE_BY_CLASS: readonly ClassStyle[] = ORBIT_CLASSES.map((c) => CLASS_STYLES[c])
const FALLBACK_STYLE = STYLE_BY_CLASS[0]

const SELECTED_PIXEL_SIZE = 6
const SELECTED_OUTLINE_COLOR = Color.fromCssColorString('#ffe8c7') // white-amber, full alpha
const SELECTED_OUTLINE_WIDTH = 2

// Module-scope scratch: updatePositions runs every sim tick for thousands of
// points and must not allocate.
const scratchPosition = new Cartesian3()

/**
 * The whole-catalog satellite layer: one PointPrimitiveCollection, one point
 * per satellite, positions mutated in place each tick. Rich visuals for the
 * selected satellite live elsewhere (TrackingVisuals) — this layer only
 * restyles the selected point.
 */
export class ConstellationLayer {
  private readonly _scene: Scene
  private readonly _points: PointPrimitiveCollection
  /** Orbit-class byte per point, in collection (= init) order. */
  private _classes: Uint8Array = new Uint8Array(0)
  private readonly _indexByNoradId = new Map<number, number>()
  private _selectedNoradId: number | null = null

  constructor(scene: Scene) {
    this._scene = scene
    this._points = new PointPrimitiveCollection()
    scene.primitives.add(this._points)
  }

  /**
   * Rebuild the layer for a new working set. `noradIds[i]` and `classes[i]`
   * describe the satellite whose position arrives at `positions[3i..3i+2]`.
   */
  setCatalog(noradIds: number[], classes: Uint8Array): void {
    if (this._isUnusable()) return
    const points = this._points
    points.removeAll()
    this._indexByNoradId.clear()
    this._selectedNoradId = null
    // Own copy: the worker/caller may reuse or transfer its buffer.
    this._classes = classes.slice()
    for (let i = 0; i < noradIds.length; i++) {
      const style = STYLE_BY_CLASS[classes[i]] ?? FALLBACK_STYLE
      points.add({
        id: noradIds[i],
        position: Cartesian3.ZERO,
        pixelSize: style.pixelSize,
        color: style.color,
        outlineWidth: 0,
        // Hidden until the first tick delivers a real position.
        show: false,
      })
      this._indexByNoradId.set(noradIds[i], i)
    }
  }

  /**
   * Per-tick position update. Layout [x0,y0,z0, x1,y1,z1, ...] in catalog
   * order, ECEF meters; a NaN triple marks a failed propagation and hides the
   * point. Zero allocations: one shared scratch Cartesian3 is reused — safe
   * because PointPrimitive's `position` setter clones the value into its
   * internal Cartesian3 (Cartesian3.clone(value, this._position) in
   * Scene/PointPrimitive; verified in cesium 1.138) and retains no reference
   * to what we pass in.
   */
  updatePositions(positions: Float32Array): void {
    if (this._isUnusable()) return
    const points = this._points
    const count = Math.min(points.length, (positions.length / 3) | 0)
    for (let i = 0; i < count; i++) {
      const point = points.get(i)
      const x = positions[3 * i]
      const y = positions[3 * i + 1]
      const z = positions[3 * i + 2]
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
        point.show = false
        continue
      }
      scratchPosition.x = x
      scratchPosition.y = y
      scratchPosition.z = z
      point.position = scratchPosition
      point.show = true
    }
  }

  /** Highlight one satellite (or none); the previous one gets its class style back. */
  setSelected(noradId: number | null): void {
    if (this._isUnusable()) return
    if (noradId === this._selectedNoradId) return

    if (this._selectedNoradId !== null) {
      const prev = this._pointFor(this._selectedNoradId)
      if (prev !== undefined) {
        const style = this._styleFor(this._selectedNoradId)
        prev.pixelSize = style.pixelSize
        prev.color = style.color
        prev.outlineWidth = 0
      }
    }

    this._selectedNoradId = noradId
    if (noradId !== null) {
      const point = this._pointFor(noradId)
      if (point !== undefined) {
        const style = this._styleFor(noradId)
        point.pixelSize = SELECTED_PIXEL_SIZE
        point.color = style.colorSolid
        point.outlineColor = SELECTED_OUTLINE_COLOR
        point.outlineWidth = SELECTED_OUTLINE_WIDTH
      }
    }
  }

  /**
   * Returns the noradId under the cursor if the picked primitive belongs to
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

  dispose(): void {
    this._indexByNoradId.clear()
    this._selectedNoradId = null
    if (this._points.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
      // also destroys the collection.
      this._scene.primitives.remove(this._points)
    }
  }

  private _isUnusable(): boolean {
    return this._points.isDestroyed() || this._scene.isDestroyed()
  }

  private _pointFor(noradId: number): PointPrimitive | undefined {
    const index = this._indexByNoradId.get(noradId)
    if (index === undefined || index >= this._points.length) return undefined
    return this._points.get(index)
  }

  private _styleFor(noradId: number): ClassStyle {
    const index = this._indexByNoradId.get(noradId)
    if (index === undefined || index >= this._classes.length) return FALLBACK_STYLE
    return STYLE_BY_CLASS[this._classes[index]] ?? FALLBACK_STYLE
  }
}
