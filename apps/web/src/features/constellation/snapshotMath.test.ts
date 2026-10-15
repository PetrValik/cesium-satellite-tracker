import { describe, expect, it } from 'vitest'
import { interpolateInto, isOccluded, LERP_ANGLE_RAD, OCCLUSION_RADIUS_M } from './snapshotMath'

const R = OCCLUSION_RADIUS_M

/**
 * Brute-force oracle for isOccluded: walk the open segment camera→point and
 * report whether any sample falls inside the occlusion sphere.
 */
function occludedBySampling(c: readonly number[], p: readonly number[]): boolean {
  const steps = 20_000
  for (let k = 1; k < steps; k++) {
    const s = k / steps
    const x = c[0] + (p[0] - c[0]) * s
    const y = c[1] + (p[1] - c[1]) * s
    const z = c[2] + (p[2] - c[2]) * s
    if (x * x + y * y + z * z < R * R) return true
  }
  return false
}

describe('isOccluded', () => {
  const camera = [3 * R, 0, 0]

  it('hides a point straight behind the globe and keeps one in front', () => {
    expect(isOccluded(3 * R, 0, 0, -2 * R, 0, 0)).toBe(true)
    expect(isOccluded(3 * R, 0, 0, 1.5 * R, 0, 0)).toBe(false)
  })

  it('keeps a point whose sight line clears the limb visible', () => {
    // Line (3R,0,0)→(0,1.2R,0) passes ~1.11 R from the centre: clear.
    expect(isOccluded(3 * R, 0, 0, 0, 1.2 * R, 0)).toBe(false)
    // Further round the far side, the sight line cuts the sphere.
    expect(isOccluded(3 * R, 0, 0, -3 * R, 1.05 * R, 0)).toBe(true)
  })

  it('treats a camera sitting on the point as not occluded', () => {
    expect(isOccluded(2 * R, 0, 0, 2 * R, 0, 0)).toBe(false)
  })

  it('agrees with a sampled segment walk', () => {
    const points = [
      [-2 * R, 0.3 * R, 0.2 * R],
      [-1.1 * R, 1.2 * R, 0],
      [0, 2 * R, 0],
      [-4 * R, 0.9 * R, 0.5 * R],
      [0.2 * R, -1.05 * R, 0.1 * R],
      [-1.3 * R, -0.4 * R, 1.0 * R],
      [5 * R, 5 * R, 5 * R],
    ]
    for (const p of points) {
      expect(isOccluded(camera[0], camera[1], camera[2], p[0], p[1], p[2])).toBe(
        occludedBySampling(camera, p),
      )
    }
  })
})

/** A point at `radius` and `angleRad` in the equatorial plane, as a flat triple. */
function polar(radius: number, angleRad: number): number[] {
  return [radius * Math.cos(angleRad), radius * Math.sin(angleRad), 0]
}

describe('interpolateInto', () => {
  const out = { x: 0, y: 0, z: 0 }

  it('follows the arc (slerp direction, lerp radius) — checked against polar coordinates', () => {
    const ra = 6_771_000
    const rb = 6_800_000
    const a0 = 0.1
    const a1 = 0.9 // well above LERP_ANGLE_RAD
    const prev = new Float64Array([0, 0, 0, ...polar(ra, a0)])
    const curr = new Float64Array([0, 0, 0, ...polar(rb, a1)])
    for (const t of [0, 0.25, 0.5, 1, -0.5, 1.7]) {
      interpolateInto(prev, curr, 1, t, out)
      const expected = polar(ra + (rb - ra) * t, a0 + (a1 - a0) * t)
      expect(out.x).toBeCloseTo(expected[0], 3)
      expect(out.y).toBeCloseTo(expected[1], 3)
      expect(out.z).toBeCloseTo(expected[2], 3)
    }
  })

  it('lerps straight below LERP_ANGLE_RAD', () => {
    const prev = polar(7e6, 0)
    const curr = polar(7e6, LERP_ANGLE_RAD / 2)
    interpolateInto(prev, curr, 0, 0.5, out)
    expect(out.x).toBe(prev[0] + (curr[0] - prev[0]) * 0.5)
    expect(out.y).toBe(prev[1] + (curr[1] - prev[1]) * 0.5)
  })

  it('falls back to the current snapshot for a failed or degenerate previous one', () => {
    const curr = [1e7, 2e6, -3e6]
    interpolateInto([Number.NaN, Number.NaN, Number.NaN], curr, 0, 0.5, out)
    expect([out.x, out.y, out.z]).toEqual(curr)
    interpolateInto([0, 0, 0], curr, 0, 0.5, out)
    expect([out.x, out.y, out.z]).toEqual(curr)
  })

  it('reads the triple at index i', () => {
    const prev = [9, 9, 9, ...polar(7e6, 0.2), 9, 9, 9]
    const curr = [8, 8, 8, ...polar(7e6, 0.6), 8, 8, 8]
    interpolateInto(prev, curr, 1, 1, out)
    expect(out.x).toBeCloseTo(curr[3], 3)
    expect(out.y).toBeCloseTo(curr[4], 3)
  })
})
