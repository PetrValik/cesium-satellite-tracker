import type { Cartesian3 } from 'cesium'

const RAD_PER_DEG = Math.PI / 180

/**
 * ECEF unit vector of horizontal travel for a bearing (degrees clockwise
 * from north) at (latDeg, lonDeg) — the world-space `Billboard.alignedAxis`
 * that points a surface glyph along its course. Uses the local ENU basis of
 * the geodetic normal (the same one `Transforms.eastNorthUpToFixedFrame`
 * builds):
 *   east  = (-sinLon, cosLon, 0)
 *   north = (-sinLat·cosLon, -sinLat·sinLon, cosLat)
 *   dir   = east·sin(brg) + north·cos(brg)
 * east and north are orthonormal, so dir is unit-length by construction.
 * Writes into `result` and returns it; allocates nothing.
 */
export function travelAxis(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  result: Cartesian3,
): Cartesian3 {
  const latRad = latDeg * RAD_PER_DEG
  const lonRad = lonDeg * RAD_PER_DEG
  const bearingRad = bearingDeg * RAD_PER_DEG
  const sinLat = Math.sin(latRad)
  const cosLat = Math.cos(latRad)
  const sinLon = Math.sin(lonRad)
  const cosLon = Math.cos(lonRad)
  const sinBrg = Math.sin(bearingRad)
  const cosBrg = Math.cos(bearingRad)
  result.x = -sinLon * sinBrg - sinLat * cosLon * cosBrg
  result.y = cosLon * sinBrg - sinLat * sinLon * cosBrg
  result.z = cosLat * cosBrg
  return result
}
