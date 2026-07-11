import {
  Cartesian3,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix3,
  Matrix4,
  PlaneGeometry,
  Primitive,
  Transforms,
  VertexFormat,
} from 'cesium'
import type { Scene } from 'cesium'

const RAD_PER_DEG = Math.PI / 180

// setPose runs per frame — no allocations beyond the pose assignment.
const scratchPosition = new Cartesian3()
const scratchEnu = new Matrix4()
const scratchRotation = new Matrix3()
const scratchRotation4 = new Matrix4()
const scratchModel = new Matrix4()

/** Bake a CSS tint into a copy of a white-on-transparent glyph canvas. */
function tintedCopy(image: HTMLCanvasElement, tintCss: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = tintCss
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(image, 0, 0)
  return canvas
}

/**
 * A flat, WORLD-oriented icon: a textured quad lying in the local
 * east-north-up plane, nose (+y of the glyph) rotated to the given bearing.
 * Unlike a billboard it does NOT face the camera — orbiting around it shows
 * the silhouette foreshortened and edge-on, like a marker printed on the
 * map. Used for the selected aircraft/vessel, whose screen-facing layer
 * billboard is hidden while selected.
 *
 * The quad is scaled per frame to a fixed fraction of the camera distance,
 * so it stays readable at any zoom (constant on-screen size, world-true
 * orientation).
 */
export class WorldDecal {
  private readonly _scene: Scene
  private readonly _primitive: Primitive
  private readonly _modelMatrix = new Matrix4()
  private _visible = false

  constructor(scene: Scene, image: HTMLCanvasElement, tintCss: string) {
    this._scene = scene
    this._primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        // Unit plane in the x-y plane (ENU: x = east, y = north, z = up) —
        // exactly the "lying on the map" orientation we want.
        geometry: new PlaneGeometry({ vertexFormat: VertexFormat.POSITION_AND_ST }),
      }),
      appearance: new MaterialAppearance({
        material: Material.fromType('Image', { image: tintedCopy(image, tintCss) }),
        translucent: true, // also disables backface culling → visible from below
        closed: false,
      }),
      asynchronous: false, // ready the frame it is added
      allowPicking: false,
      show: false,
    })
    scene.primitives.add(this._primitive)
  }

  /**
   * Place the decal. `bearingDeg` is clockwise from north; the glyph points
   * up (+y = north in ENU), so rotating about local up by -bearing points
   * the nose along the direction of travel in WORLD space.
   */
  setPose(
    lonDeg: number,
    latDeg: number,
    altM: number,
    bearingDeg: number,
    cameraPosition: Cartesian3,
    screenFraction = 0.035,
    minSizeM = 50,
  ): void {
    if (this._isUnusable()) return
    Cartesian3.fromDegrees(lonDeg, latDeg, altM, undefined, scratchPosition)
    Transforms.eastNorthUpToFixedFrame(scratchPosition, undefined, scratchEnu)
    Matrix3.fromRotationZ(-bearingDeg * RAD_PER_DEG, scratchRotation)
    Matrix4.fromRotationTranslation(scratchRotation, Cartesian3.ZERO, scratchRotation4)
    Matrix4.multiply(scratchEnu, scratchRotation4, scratchModel)
    // Constant apparent size: scale with camera distance (constant while
    // follow-locked, since the range is fixed).
    const distance = Cartesian3.distance(cameraPosition, scratchPosition)
    const sizeM = Math.max(minSizeM, distance * screenFraction)
    Matrix4.multiplyByUniformScale(scratchModel, sizeM, scratchModel)
    this._primitive.modelMatrix = Matrix4.clone(scratchModel, this._modelMatrix)
    if (!this._visible) {
      this._primitive.show = true
      this._visible = true
    }
  }

  hide(): void {
    if (!this._visible || this._isUnusable()) return
    this._primitive.show = false
    this._visible = false
  }

  dispose(): void {
    if (this._primitive.isDestroyed()) return
    if (!this._scene.isDestroyed()) {
      this._scene.primitives.remove(this._primitive)
    }
  }

  private _isUnusable(): boolean {
    return this._primitive.isDestroyed() || this._scene.isDestroyed()
  }
}
