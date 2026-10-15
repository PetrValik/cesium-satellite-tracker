import type { Vec3Like } from '../../lib/orbital'

/**
 * The per-frame math of ConstellationLayer.advance(), Cesium-free so it is
 * unit-testable: the horizon-culling pre-test and the interpolation between
 * two worker snapshots. Both run once per satellite per frame (12k+), so
 * neither allocates.
 */

/**
 * Occlusion sphere for the horizon-culling pre-test: slightly smaller than
 * Earth so satellites near the limb never pop early — anything the margin
 * lets through is still hidden by the depth test.
 */
export const OCCLUSION_RADIUS_M = 6_300_000
const OCCLUSION_RADIUS_SQ = OCCLUSION_RADIUS_M * OCCLUSION_RADIUS_M

/**
 * Below this arc between samples, a straight lerp is indistinguishable from
 * the spherical arc (sagitta < ~2 km at LEO radius) and much cheaper.
 */
export const LERP_ANGLE_RAD = 0.02

/**
 * True when the segment camera→point passes through the occlusion sphere
 * (i.e. the point is behind the globe). Ray–sphere math, ECEF metres.
 */
export function isOccluded(
  cx: number,
  cy: number,
  cz: number,
  px: number,
  py: number,
  pz: number,
): boolean {
  const dxr = px - cx
  const dyr = py - cy
  const dzr = pz - cz
  const a = dxr * dxr + dyr * dyr + dzr * dzr
  const b = cx * dxr + cy * dyr + cz * dzr
  const c = cx * cx + cy * cy + cz * cz - OCCLUSION_RADIUS_SQ
  const disc = b * b - a * c
  if (disc <= 0 || a === 0) return false
  const s = (-b - Math.sqrt(disc)) / a
  return s > 0 && s < 1
}

/**
 * Position of satellite `i` at interpolation parameter `t` between snapshot
 * `prev` (t = 0) and `curr` (t = 1), both flat [x0,y0,z0, …] ECEF-metre
 * arrays in catalog order, written into `out`. Slerp on direction, lerp on
 * radius: for a near-circular orbit this follows the true arc, and t outside
 * [0, 1] continues along the same arc. Below LERP_ANGLE_RAD a straight lerp
 * stands in. A NaN or zero-radius `prev` triple yields `curr` unchanged; the
 * caller must already have rejected a NaN `curr` triple.
 */
export function interpolateInto(
  prev: ArrayLike<number>,
  curr: ArrayLike<number>,
  i: number,
  t: number,
  out: Vec3Like,
): void {
  const o = 3 * i
  const bx = curr[o]
  const by = curr[o + 1]
  const bz = curr[o + 2]
  out.x = bx
  out.y = by
  out.z = bz
  const ax = prev[o]
  const ay = prev[o + 1]
  const az = prev[o + 2]
  const ra = Math.sqrt(ax * ax + ay * ay + az * az)
  const rb = Math.sqrt(bx * bx + by * by + bz * bz)
  // Negated so a NaN radius (failed `prev` triple) also bails out.
  if (!(ra > 0 && rb > 0)) return
  let cos = (ax * bx + ay * by + az * bz) / (ra * rb)
  if (cos > 1) cos = 1
  else if (cos < -1) cos = -1
  const theta = Math.acos(cos)
  if (theta < LERP_ANGLE_RAD) {
    out.x = ax + (bx - ax) * t
    out.y = ay + (by - ay) * t
    out.z = az + (bz - az) * t
    return
  }
  const sinTheta = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / (sinTheta * ra)
  const wb = Math.sin(t * theta) / (sinTheta * rb)
  const r = ra + (rb - ra) * t
  out.x = (ax * wa + bx * wb) * r
  out.y = (ay * wa + by * wb) * r
  out.z = (az * wa + bz * wb) * r
}
