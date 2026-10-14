import { Camera, Cartesian3, GeographicProjection, Matrix4 } from 'cesium'
import type { Viewer } from 'cesium'
import { describe, expect, it } from 'vitest'
import { CameraRig } from './CameraRig'

/**
 * A real Cesium `Camera` on a fake scene: the camera math needs only the
 * drawing-buffer size and the map projection, not WebGL.
 */
function makeRig() {
  const scene = {
    drawingBufferWidth: 375,
    drawingBufferHeight: 667,
    mapProjection: new GeographicProjection(),
  }
  const camera = new Camera(scene as never)
  const viewer = {
    camera,
    scene,
    isDestroyed: () => false,
  } as unknown as Viewer
  return { rig: new CameraRig(viewer), camera }
}

/** Distance from the camera to `target` and the target's bearing in the camera's own axes. */
function view(camera: Camera, target: Cartesian3) {
  const toTarget = Cartesian3.subtract(target, camera.positionWC, new Cartesian3())
  const range = Cartesian3.magnitude(toTarget)
  Cartesian3.normalize(toTarget, toTarget)
  return {
    range,
    // Components along the camera axes fix the target's screen position.
    fwd: Cartesian3.dot(toTarget, camera.directionWC),
    right: Cartesian3.dot(toTarget, camera.rightWC),
    up: Cartesian3.dot(toTarget, camera.upWC),
  }
}

describe('CameraRig follow-lock', () => {
  // ISS-like orbit: ~6 780 km radius, ~7.66 km/s.
  const R = 6_780_000
  const OMEGA = 7_660 / R
  const issAt = (tS: number, out: Cartesian3) =>
    Cartesian3.fromElements(R * Math.cos(OMEGA * tS), R * Math.sin(OMEGA * tS) * 0.6, R * Math.sin(OMEGA * tS) * 0.8, out)

  it('keeps range and screen bearing while the target moves', () => {
    const { rig, camera } = makeRig()
    const target = issAt(0, new Cartesian3())
    // A target that resolves after follow() engages directly (no fly-in).
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(false)
    const start = view(camera, target)
    expect(start.range).toBeCloseTo(1_500_000, -1)

    // 15 s at ×60 in one-second frames: the target sweeps ~6 900 km.
    for (let s = 1; s <= 15 * 60; s += 60) {
      issAt(s, target)
      rig.update(1000)
      const now = view(camera, target)
      expect(now.range / start.range).toBeCloseTo(1, 6)
      expect(now.fwd).toBeCloseTo(start.fwd, 6)
      expect(now.right).toBeCloseTo(start.right, 6)
      expect(now.up).toBeCloseTo(start.up, 6)
    }
    rig.dispose()
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(true)
  })

  it('keeps a user orbit applied while locked', () => {
    const { rig, camera } = makeRig()
    const target = issAt(0, new Cartesian3())
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    // An orbit around the target (what a drag or the A key does in the frame).
    camera.rotateRight(0.5)
    const local = Cartesian3.clone(camera.position)
    issAt(120, target)
    rig.update(16)
    expect(Cartesian3.equalsEpsilon(camera.position, local, 0, 1e-6)).toBe(true)
    expect(view(camera, target).range).toBeCloseTo(1_500_000, -1)
    rig.dispose()
  })
})
