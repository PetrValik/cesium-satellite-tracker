import {
  BoundingSphere,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  Matrix4,
  Transforms,
  HeadingPitchRange,
  IntersectionTests,
  Ray,
} from 'cesium'
import type { Viewer } from 'cesium'
import { HOME_VIEW } from './createViewer'

/** Duration of the fly-in before the follow frame engages. */
const FLY_TO_SECONDS = 1.2
/** Duration of a HOME / fly-to-a-point flight. */
const FLIGHT_SECONDS = 1.5
/** Duration of the free camera's level-north flight. */
const LEVEL_SECONDS = 0.6

/** Rotation speed for held movement keys, radians per second. */
const ROTATE_RAD_PER_S = 1.1
/** Zoom step per second as a fraction of camera height / follow range. */
const ZOOM_PER_S = 0.9
/** Follow orbit is never allowed closer than this. */
const MIN_FOLLOW_RANGE_M = 2_000
/** One zoom tap halves (in) or doubles (out) the distance over this long. */
const ZOOM_STEP_SECONDS = 0.3
/** Exponential zoom rate per second: e^(rate · ZOOM_STEP_SECONDS) = 2. */
const ZOOM_RATE = Math.LN2 / ZOOM_STEP_SECONDS

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
const scratchLocalPosition = new Cartesian3()
const scratchLocalDirection = new Cartesian3()
const scratchLocalUp = new Cartesian3()
const scratchCartographic = new Cartographic()
// Per-tap scratches (levelNorth). Never hand one to a flight as its destination.
const scratchRay = new Ray()
const scratchCenter = new Cartesian3()
/** Locked level-north pose around the target: north-up, straight down; range set per call. */
const scratchLevel = new HeadingPitchRange(0, -CesiumMath.PI_OVER_TWO, 0)

/**
 * Keyboard camera movement + follow-lock.
 *
 * Follow puts the camera in an east-north-up frame at the target
 * (`camera.lookAtTransform`) and moves that frame to the target every frame
 * while restoring the camera's frame-local pose, so it rides along at a fixed
 * offset; mouse drags and the movement keys orbit the target. Without a
 * target the same keys rotate/zoom the free camera around the globe.
 */
export class CameraRig {
  private readonly _viewer: Viewer
  private readonly _pressed = new Set<string>()
  private _getTarget: (() => Cartesian3 | null) | null = null
  private _needsInitialOffset = false
  private _initialRangeM = 1_000_000
  /** Non-null while the fly-in animation toward a new target is running. */
  private _transitionTarget: (() => Cartesian3 | null) | null = null
  /** Pending zoom impulse: its direction (1 in, -1 out) and the seconds still to run. */
  private _zoomDir: 1 | -1 = 1
  private _zoomLeftS = 0

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

  /**
   * One smooth zoom step: `1` halves the distance (in), `-1` doubles it
   * (out), over ZOOM_STEP_SECONDS. A same-direction tap while one is pending
   * adds another step; an opposite tap replaces the rest. A running flight
   * is cancelled first — a follow fly-in then engages the lock synchronously
   * (its `cancel: engage`), so the step zooms the follow range.
   */
  zoomStep(direction: 1 | -1): void {
    if (this._viewer.isDestroyed()) return
    this._viewer.camera.cancelFlight()
    if (this._zoomLeftS > 0 && this._zoomDir === direction) {
      this._zoomLeftS += ZOOM_STEP_SECONDS
    } else {
      this._zoomDir = direction
      this._zoomLeftS = ZOOM_STEP_SECONDS
    }
  }

  /**
   * Fly north-up, looking straight down, to `heightM` over the point, in
   * FLIGHT_SECONDS. Drops a follow lock first — a safety net: the command
   * wiring has already released it through `useFollow`.
   */
  flyTo(lonDeg: number, latDeg: number, heightM: number): void {
    if (this._viewer.isDestroyed()) return
    this.unfollow()
    this._stopMotion()
    this._fly(Cartesian3.fromDegrees(lonDeg, latDeg, heightM), FLIGHT_SECONDS)
  }

  /** Fly back to the first-visit view. */
  flyHome(): void {
    this.flyTo(HOME_VIEW.lonDeg, HOME_VIEW.latDeg, HOME_VIEW.heightM)
  }

  /**
   * North-up, looking straight down, at the same distance. Free: fly over the
   * screen-centre point on the ellipsoid (the camera's own spot when it looks
   * at space). Locked: re-pose inside the follow frame and keep the lock — a
   * flight would drop the frame.
   */
  levelNorth(): void {
    if (this._viewer.isDestroyed()) return
    // Before the lock check: cancelling a follow fly-in engages the lock.
    this._stopMotion()
    const camera = this._viewer.camera

    if (this._getTarget !== null) {
      const target = this._getTarget()
      if (target === null) return
      Transforms.eastNorthUpToFixedFrame(target, undefined, scratchTransform)
      scratchLevel.range = Cartesian3.magnitude(camera.position) // target-local
      camera.lookAtTransform(scratchTransform, scratchLevel)
      this._needsInitialOffset = false
      return
    }

    const ellipsoid = this._viewer.scene.globe.ellipsoid
    Cartesian3.clone(camera.positionWC, scratchRay.origin)
    Cartesian3.clone(camera.directionWC, scratchRay.direction)
    const hit = IntersectionTests.rayEllipsoid(scratchRay, ellipsoid)
    let spot: Cartographic | undefined
    let heightM: number
    if (hit !== undefined) {
      // Camera.pickEllipsoid's rule: the near hit, or the far one from inside.
      Ray.getPoint(scratchRay, hit.start > 0 ? hit.start : hit.stop, scratchCenter)
      heightM = Cartesian3.distance(camera.positionWC, scratchCenter)
      spot = ellipsoid.cartesianToCartographic(scratchCenter, scratchCartographic)
    } else {
      spot = ellipsoid.cartesianToCartographic(camera.positionWC, scratchCartographic)
      heightM = spot?.height ?? 0
    }
    if (spot === undefined) return
    this._fly(Cartesian3.fromRadians(spot.longitude, spot.latitude, heightM), LEVEL_SECONDS)
  }

  /** Per-frame: refresh the follow frame, run the zoom impulse and apply held movement keys. */
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
        } else if (Matrix4.equals(camera.transform, Matrix4.IDENTITY)) {
          // Something dropped the frame (a flight, setView): re-adopt it at
          // the current world pose rather than misread a world pose as local.
          camera.lookAtTransform(scratchTransform)
        } else {
          // lookAtTransform(transform) alone keeps the camera's WORLD pose
          // (Camera._setTransform re-expresses it in the new frame), so the
          // target would drift off-screen. Carry the frame-local pose — any
          // drag/key orbit already applied to it — across the frame move.
          Cartesian3.clone(camera.position, scratchLocalPosition)
          Cartesian3.clone(camera.direction, scratchLocalDirection)
          Cartesian3.clone(camera.up, scratchLocalUp)
          camera.lookAtTransform(scratchTransform)
          Cartesian3.clone(scratchLocalPosition, camera.position)
          Cartesian3.clone(scratchLocalDirection, camera.direction)
          Cartesian3.clone(scratchLocalUp, camera.up)
          Cartesian3.cross(camera.direction, camera.up, camera.right)
        }
      }
    }

    // Zoom impulse: exact exponential steps, so the result is the same at any
    // frame rate. Numbers only — no allocation.
    if (this._zoomLeftS > 0) {
      const s = Math.min(dt, this._zoomLeftS)
      this._zoomLeftS -= s
      const d = this._distance()
      if (this._zoomDir === 1) {
        const floor = this._getTarget !== null ? MIN_FOLLOW_RANGE_M : 0
        camera.zoomIn(Math.min(d * (1 - Math.exp(-ZOOM_RATE * s)), Math.max(0, d - floor)))
      } else camera.zoomOut(d * (Math.exp(ZOOM_RATE * s) - 1))
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
      const step = Math.max(this._distance(), MIN_FOLLOW_RANGE_M) * ZOOM_PER_S * dt
      if (zoomIn) camera.zoomIn(step)
      if (zoomOut) camera.zoomOut(step)
    }
  }

  dispose(): void {
    this.unfollow()
    this._pressed.clear()
    this._zoomLeftS = 0
  }

  /** Drop a pending zoom step and any running flight. */
  private _stopMotion(): void {
    this._zoomLeftS = 0
    this._viewer.camera.cancelFlight()
  }

  /**
   * Fly north-up, straight down. `destination` must be a fresh Cartesian3:
   * Cesium closes over it for the whole flight (CameraFlightPath
   * createUpdate3D), so a scratch would be overwritten mid-flight.
   */
  private _fly(destination: Cartesian3, seconds: number): void {
    this._viewer.camera.flyTo({
      destination,
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
      duration: seconds,
    })
  }

  /** Follow range while locked, else the free camera's height above the ellipsoid. */
  private _distance(): number {
    const camera = this._viewer.camera
    return this._getTarget !== null
      ? Cartesian3.magnitude(camera.position) // position is target-local while following
      : this._viewer.scene.globe.ellipsoid.cartesianToCartographic(
          camera.position,
          scratchCartographic,
        )?.height ?? 1e6
  }
}
