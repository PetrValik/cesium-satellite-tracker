import { Cartesian3, Cartesian4, Matrix4, Transforms } from 'cesium'
import { describe, expect, it } from 'vitest'
import { travelAxis } from './travelAxis'

const RAD_PER_DEG = Math.PI / 180

/**
 * Independent oracle: Cesium's own ENU frame at the surface point (columns
 * 0 and 1 are east and north), combined as east·sin(brg) + north·cos(brg).
 */
function cesiumAxis(latDeg: number, lonDeg: number, bearingDeg: number): Cartesian3 {
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lonDeg, latDeg, 0))
  const east = Matrix4.getColumn(enu, 0, new Cartesian4())
  const north = Matrix4.getColumn(enu, 1, new Cartesian4())
  const s = Math.sin(bearingDeg * RAD_PER_DEG)
  const c = Math.cos(bearingDeg * RAD_PER_DEG)
  return new Cartesian3(east.x * s + north.x * c, east.y * s + north.y * c, east.z * s + north.z * c)
}

describe('travelAxis', () => {
  it('points north and east at the origin', () => {
    const out = new Cartesian3()
    expect(Cartesian3.equalsEpsilon(travelAxis(0, 0, 0, out), Cartesian3.UNIT_Z, 1e-15)).toBe(true)
    expect(Cartesian3.equalsEpsilon(travelAxis(0, 0, 90, out), Cartesian3.UNIT_Y, 1e-15)).toBe(true)
  })

  it("matches Cesium's east-north-up frame and stays unit length", () => {
    const out = new Cartesian3()
    for (const [lat, lon, brg] of [
      [51.5, -0.1, 37],
      [-33.9, 151.2, 200],
      [70, 179.9, 315],
      [-89, 45, 90],
      [12.3, -120, 0],
    ]) {
      travelAxis(lat, lon, brg, out)
      expect(Cartesian3.equalsEpsilon(out, cesiumAxis(lat, lon, brg), 1e-12)).toBe(true)
      expect(Cartesian3.magnitude(out)).toBeCloseTo(1, 12)
    }
  })

  it('writes into and returns the result instance', () => {
    const out = new Cartesian3()
    expect(travelAxis(10, 20, 30, out)).toBe(out)
  })
})
