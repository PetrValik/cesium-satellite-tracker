import { describe, expect, it } from 'vitest'
import { project, SKY_R } from './skyProjection'

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9)
  expect(p.y).toBeCloseTo(y, 9)
}

describe('sky plot projection', () => {
  it('puts the zenith at the centre for any azimuth', () => {
    close(project(0, 90), 0, 0)
    close(project(237, 90), 0, 0)
  })

  it('draws north up (−y) and east right (+x) on the horizon ring', () => {
    close(project(0, 0), 0, -SKY_R)
    close(project(90, 0), SKY_R, 0)
    close(project(180, 0), 0, SKY_R)
    close(project(270, 0), -SKY_R, 0)
  })

  it('scales the radius linearly with zenith distance', () => {
    close(project(90, 45), SKY_R / 2, 0)
    close(project(0, 60), 0, -SKY_R / 3)
  })

  it('clamps below-horizon samples to the rim', () => {
    close(project(90, -10), SKY_R, 0)
  })
})
