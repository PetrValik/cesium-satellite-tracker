import { Camera, Cartesian3, Ellipsoid, GeographicProjection, Math as CesiumMath, Matrix4 } from 'cesium'
import type { Viewer } from 'cesium'
import { describe, expect, it, vi } from 'vitest'
import { CameraRig } from './CameraRig'
import { HOME_VIEW } from './createViewer'

/**
 * A real Cesium `Camera` on a fake scene: the camera math needs only the
 * drawing-buffer size and the map projection, not WebGL.
 */
function makeRig() {
  const scene = {
    drawingBufferWidth: 375,
    drawingBufferHeight: 667,
    mapProjection: new GeographicProjection(),
    // Free-camera distance (zoom) reads the globe's ellipsoid.
    globe: { ellipsoid: Ellipsoid.WGS84 },
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

const heightOf = (camera: Camera) => Ellipsoid.WGS84.cartesianToCartographic(camera.positionWC).height
const frames = (rig: CameraRig, n: number, dtMs: number) => { for (let i = 0; i < n; i++) rig.update(dtMs) }

describe('CameraRig zoomStep', () => {
  it('one tap halves / doubles the free camera height over ~0.3 s, at any frame rate', () => {
    for (const [dtMs, n] of [[16, 40], [100, 5]] as const) {
      const { rig, camera } = makeRig()
      camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
      rig.zoomStep(1)
      frames(rig, n, dtMs)
      expect(heightOf(camera) / 4e6).toBeCloseTo(1, 3)
    }
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    rig.zoomStep(-1)
    frames(rig, 40, 16)
    expect(heightOf(camera) / 16e6).toBeCloseTo(1, 3)
  })
  it('two quick taps stack; an opposite tap replaces the rest', () => {
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    rig.zoomStep(1); rig.zoomStep(1)
    frames(rig, 60, 16)
    expect(heightOf(camera) / 2e6).toBeCloseTo(1, 3)
    rig.zoomStep(1); rig.zoomStep(-1)
    frames(rig, 40, 16)
    expect(heightOf(camera) / 4e6).toBeCloseTo(1, 3)
  })
  it('zooms the follow range while locked, never under 2 km', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    rig.zoomStep(1)
    frames(rig, 40, 16)
    expect(view(camera, target).range / 750_000).toBeCloseTo(1, 3)
    expect(rig.isFollowing()).toBe(true)
    rig.dispose()
  })
  it('never zooms a locked camera under 2 km', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 3_000)
    ready = true
    rig.update(16)
    rig.zoomStep(1); rig.zoomStep(1); rig.zoomStep(1)
    frames(rig, 80, 16)
    expect(view(camera, target).range).toBeCloseTo(2_000, 0)
    expect(rig.isFollowing()).toBe(true)
    rig.dispose()
  })
})

const NORTH_DOWN = { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
const stubFlights = (camera: Camera) => vi.spyOn(camera, 'flyTo').mockImplementation(() => {})
type FlyOptions = { destination: Cartesian3; orientation: unknown; duration: number }
const deg = (p: Cartesian3) => {
  const c = Ellipsoid.WGS84.cartesianToCartographic(p)
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), h: c.height }
}

describe('CameraRig navigation flights', () => {
  it('HOME_VIEW is the first-visit view', () => {
    expect(HOME_VIEW).toEqual({ lonDeg: 15, latDeg: 35, heightM: 28_000_000 })
  })
  it('flyHome / flyTo fly north-up, looking straight down, in 1.5 s', () => {
    const { rig, camera } = makeRig()
    const fly = stubFlights(camera)
    rig.flyHome()
    rig.flyTo(14.42, 50.08, 500_000)
    const [home, here] = fly.mock.calls.map(([o]) => o as FlyOptions)
    expect(Cartesian3.equalsEpsilon(home.destination, Cartesian3.fromDegrees(15, 35, 28e6), 0, 1)).toBe(true)
    expect(Cartesian3.equalsEpsilon(here.destination, Cartesian3.fromDegrees(14.42, 50.08, 5e5), 0, 1)).toBe(true)
    expect(home.orientation).toEqual(NORTH_DOWN)
    expect(here.duration).toBe(1.5)
  })
  it('a flight drops a pending zoom step and a follow lock', () => {
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    stubFlights(camera)
    rig.zoomStep(1)
    rig.flyHome()
    for (let i = 0; i < 40; i++) rig.update(16)
    expect(deg(camera.positionWC).h).toBeCloseTo(8e6, -1)
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    rig.flyTo(0, 0, 1e6)
    expect(rig.isFollowing()).toBe(false)
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(true)
  })
  it('levelNorth (free) flies over the screen-centre point at the same distance', () => {
    const cases = [
      // straight down, rotated 30°: centre is the sub-camera point
      { at: [10, 40, 5e6], headingDeg: 30, pitchDeg: -90, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 2); expect(Math.abs(d.lat - 40)).toBeLessThan(0.1); expect(d.h).toBeCloseTo(5e6, -4) } },
      // tilted 45° north: centre lies ~23° north, ~3 556 km away
      { at: [10, 40, 2e6], headingDeg: 0, pitchDeg: -45, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 2); expect(d.lat).toBeGreaterThan(60); expect(d.h).toBeCloseTo(3.556e6, -4) } },
      // looking at space: falls back to the camera's own spot and height
      { at: [10, 40, 2e7], headingDeg: 0, pitchDeg: 0, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 4); expect(d.lat).toBeCloseTo(40, 4); expect(d.h).toBeCloseTo(2e7, -1) } },
    ]
    for (const c of cases) {
      const { rig, camera } = makeRig()
      camera.setView({ destination: Cartesian3.fromDegrees(c.at[0], c.at[1], c.at[2]),
        orientation: { heading: CesiumMath.toRadians(c.headingDeg), pitch: CesiumMath.toRadians(c.pitchDeg), roll: 0 } })
      const fly = stubFlights(camera)
      rig.levelNorth()
      const o = fly.mock.calls[0][0] as FlyOptions
      c.check(deg(o.destination))
      expect(o.orientation).toEqual(NORTH_DOWN)
      expect(o.duration).toBe(0.6)
    }
  })
  it('levelNorth (locked) levels around the target, keeps lock and range, holds as the target moves', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    camera.rotateRight(0.5)
    rig.levelNorth()
    const level = () => {
      const h = CesiumMath.toDegrees(camera.heading)
      expect(Math.min(h, 360 - h)).toBeLessThan(0.1)
      expect(Math.abs(CesiumMath.toDegrees(camera.pitch) + 90)).toBeLessThan(0.1)
      expect(view(camera, target).fwd).toBeCloseTo(1, 6)
      expect(view(camera, target).range).toBeCloseTo(1_500_000, -1)
    }
    level()
    expect(rig.isFollowing()).toBe(true)
    Cartesian3.fromDegrees(20, 45, 400_000, undefined, target)
    rig.update(16)
    level()
    rig.dispose()
  })
})
