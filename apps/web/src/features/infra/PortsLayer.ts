import {
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  LabelCollection,
  PointPrimitiveCollection,
} from 'cesium'
import type { Scene } from 'cesium'

/** Static port descriptor (matches ports.json rows). */
export interface Port {
  id: string
  name: string
  latDeg: number
  lonDeg: number
}

const POINT_COLOR = Color.fromCssColorString('#6ee7ff') // cyan
const POINT_PIXEL_SIZE = 3

const LABEL_FONT = '10px monospace'
const LABEL_FILL = Color.fromCssColorString('#d7dde6')
/** Up-right of the point (screen space: +x right, -y up). */
const LABEL_OFFSET = new Cartesian2(8, -8)
/**
 * Labels only render when the camera is within ~12,000 km — points stay
 * visible from any distance, the text would just be clutter from orbit.
 * Shared across all labels; the Label setter clones it and we never mutate.
 */
const LABEL_DISPLAY_CONDITION = new DistanceDisplayCondition(0, 12_000_000)

// Constructor-only scratch (the layer is static; nothing runs per frame).
// Safe to share because PointPrimitive/Label position handling clones the
// value rather than retaining our reference (verified in cesium 1.138).
const scratchPosition = new Cartesian3()

/**
 * Static overlay of major seaports: one cyan point (no outline) plus one
 * name label per port, built once in the constructor. Points and labels
 * keep the default disableDepthTestDistance, so they hide behind the globe.
 */
export class PortsLayer {
  private readonly _scene: Scene
  private readonly _points: PointPrimitiveCollection
  private readonly _labels: LabelCollection

  constructor(scene: Scene, ports: Port[]) {
    this._scene = scene
    this._points = new PointPrimitiveCollection()
    this._labels = new LabelCollection()
    scene.primitives.add(this._points)
    scene.primitives.add(this._labels)

    for (const port of ports) {
      Cartesian3.fromDegrees(port.lonDeg, port.latDeg, 0, undefined, scratchPosition)
      this._points.add({
        id: port.id,
        position: scratchPosition,
        pixelSize: POINT_PIXEL_SIZE,
        color: POINT_COLOR,
        outlineWidth: 0,
      })
      this._labels.add({
        id: port.id,
        position: scratchPosition,
        text: port.name,
        font: LABEL_FONT,
        fillColor: LABEL_FILL,
        pixelOffset: LABEL_OFFSET,
        distanceDisplayCondition: LABEL_DISPLAY_CONDITION,
      })
    }
  }

  /** Show or hide the whole layer (points and labels together). */
  setVisible(visible: boolean): void {
    if (this._isUnusable()) return
    this._points.show = visible
    this._labels.show = visible
  }

  /**
   * Returns the port id under the cursor if the picked primitive (point or
   * label) belongs to this layer, else null.
   */
  pick(windowPosition: Cartesian2, scene: Scene): string | null {
    if (scene.isDestroyed() || this._points.isDestroyed() || this._labels.isDestroyed()) {
      return null
    }
    // Scene.pick returns { primitive, collection, id } for points and labels.
    const picked = scene.pick(windowPosition) as
      | { collection?: unknown; id?: unknown }
      | undefined
    if (
      picked !== undefined &&
      (picked.collection === this._points || picked.collection === this._labels) &&
      typeof picked.id === 'string'
    ) {
      return picked.id
    }
    return null
  }

  dispose(): void {
    if (this._scene.isDestroyed()) return
    // PrimitiveCollection.destroyPrimitives defaults to true, so remove()
    // also destroys each collection.
    if (!this._points.isDestroyed()) this._scene.primitives.remove(this._points)
    if (!this._labels.isDestroyed()) this._scene.primitives.remove(this._labels)
  }

  private _isUnusable(): boolean {
    return this._points.isDestroyed() || this._labels.isDestroyed() || this._scene.isDestroyed()
  }
}
