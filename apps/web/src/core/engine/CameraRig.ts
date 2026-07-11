import {
  BoundingSphere,
  Cartesian3,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  HeadingPitchRange,
} from 'cesium'
import type { Viewer } from 'cesium'

/** Duration of the fly-in before the follow frame engages. */
const FLY_TO_SECONDS = 1.2

/** Rotation speed for held movement keys, radians per second. */
const ROTATE_RAD_PER_S = 1.1
/** Zoom step per second as a fraction of camera height / follow range. */
const ZOOM_PER_S = 0.9
/** Follow orbit is never allowed closer than this. */
const MIN_FOLLOW_RANGE_M = 2_000

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

// Scratches — update() runs per frame and must not allocate.
const scratchTransform = new Matrix4()
const scratchTarget = new Cartesian3()

/**
 * Keyboard camera movement + follow-lock.
 *
 * Follow uses `camera.lookAtTransform` with an east-north-up frame refreshed
 * to the target's position every frame: the camera keeps its offset in the
 * target-local frame, so it rides along as the target moves, and both mouse
 * drags and the movement keys orbit the target. Without a target the same
 * keys rotate/zoom the free camera around the globe.
 */
export class CameraRig {
  private readonly _viewer: Viewer
  private readonly _pressed = new Set<string>()
  private _getTarget: (() => Cartesian3 | null) | null = null
  private _needsInitialOffset = false
  private _initialRangeM = 1_000_000
  /** Non-null while the fly-in animation toward a new target is running. */
  private _transitionTarget: (() => Cartesian3 | null) | null = null

  constructor(viewer: Viewer) {
    this._viewer = viewer
  }

  /** True when `code` is a camera-movement key this rig consumes. */
  static isMovementKey(code: string): boolean {
    return MOVEMENT_KEYS.has(code)
  }

  press(code: string): void {
    this._pressed.add(code)
  }

  release(code: string): void {
    this._pressed.delete(code)
  }

  /** Window lost focus — treat every key as released. */
  releaseAll(): void {
    this._pressed.clear()
  }

  /**
   * Engage follow-lock. `getTarget` is polled every frame and may return
   * null while the target is momentarily unavailable (keeps the last frame).
   * The camera flies to the target first (a hard cut read as a "refresh"),
   * then the follow frame engages seamlessly at the flight's end position.
   */
  follow(getTarget: () => Cartesian3 | null, initialRangeM: number): void {
    this._initialRangeM = Math.max(initialRangeM, MIN_FOLLOW_RANGE_M)
    const viewer = this._viewer
    if (viewer.isDestroyed()) return
    const targetNow = getTarget()
    if (targetNow === null) {
      // Nothing to fly to yet — engage directly; update() snaps when the
      // target first resolves.
      this._transitionTarget = null
      this._getTarget = getTarget
      this._needsInitialOffset = true
      return
    }

    // Release any previous frame/flight so the fly-in starts in world space.
    viewer.camera.cancelFlight()
    if (this._getTarget !== null) viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    this._getTarget = null
    this._transitionTarget = getTarget

    const engage = () => {
      if (this._transitionTarget !== getTarget || viewer.isDestroyed()) return
      this._transitionTarget = null
      this._getTarget = getTarget
      this._needsInitialOffset = false
      // Adopting the frame without an offset keeps the camera exactly where
      // the flight ended — no visible jump.
      const target = getTarget()
      if (target !== null) {
        Transforms.eastNorthUpToFixedFrame(target, undefined, scratchTransform)
        viewer.camera.lookAtTransform(scratchTransform)
      } else {
        this._needsInitialOffset = true
      }
    }

    viewer.camera.flyToBoundingSphere(new BoundingSphere(targetNow, 1), {
      duration: FLY_TO_SECONDS,
      offset: new HeadingPitchRange(
        viewer.camera.heading,
        CesiumMath.toRadians(-35),
        this._initialRangeM,
      ),
      complete: engage,
      // A cancelled flight (user grabbed the mouse) still honors the lock
      // intent — engage at wherever the camera stopped.
      cancel: engage,
    })
  }

  /** Release follow-lock; the camera stays where it is, in the world frame. */
  unfollow(): void {
    if (this._getTarget === null && this._transitionTarget === null) return
    this._transitionTarget = null
    this._getTarget = null
    if (!this._viewer.isDestroyed()) {
      this._viewer.camera.cancelFlight()
      this._viewer.camera.lookAtTransform(Matrix4.IDENTITY)
    }
  }

  isFollowing(): boolean {
    return this._getTarget !== null || this._transitionTarget !== null
  }

  /** Per-frame: refresh the follow frame and apply held movement keys. */
  update(dtMs: number): void {
    if (this._viewer.isDestroyed()) return
    const camera = this._viewer.camera
    const dt = dtMs / 1000

    if (this._getTarget !== null) {
      const target = this._getTarget()
      if (target !== null) {
        Cartesian3.clone(target, scratchTarget)
        Transforms.eastNorthUpToFixedFrame(scratchTarget, undefined, scratchTransform)
        if (this._needsInitialOffset) {
          this._needsInitialOffset = false
          camera.lookAtTransform(
            scratchTransform,
            new HeadingPitchRange(camera.heading, CesiumMath.toRadians(-35), this._initialRangeM),
          )
        } else {
          // Refreshing the transform alone carries the camera's local offset
          // along with the moving target.
          camera.lookAtTransform(scratchTransform)
        }
      }
    }

    if (this._pressed.size === 0) return
    const rot = ROTATE_RAD_PER_S * dt
    if (this._pressed.has('KeyA') || this._pressed.has('ArrowLeft')) camera.rotateLeft(rot)
    if (this._pressed.has('KeyD') || this._pressed.has('ArrowRight')) camera.rotateRight(rot)
    if (this._pressed.has('KeyW') || this._pressed.has('ArrowUp')) camera.rotateUp(rot)
    if (this._pressed.has('KeyS') || this._pressed.has('ArrowDown')) camera.rotateDown(rot)

    const zoomIn = this._pressed.has('KeyQ')
    const zoomOut = this._pressed.has('KeyE')
    if (zoomIn || zoomOut) {
      // Scale the step to the current distance so zooming feels uniform from
      // LEO range down to airport range.
      const distance = this._getTarget !== null
        ? Cartesian3.magnitude(camera.position) // position is target-local while following
        : this._viewer.scene.globe.ellipsoid.cartesianToCartographic(camera.position)?.height ?? 1e6
      const step = Math.max(distance, MIN_FOLLOW_RANGE_M) * ZOOM_PER_S * dt
      if (zoomIn) camera.zoomIn(step)
      if (zoomOut) camera.zoomOut(step)
    }
  }

  dispose(): void {
    this.unfollow()
    this._pressed.clear()
  }
}
