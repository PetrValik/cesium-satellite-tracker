/** Sky-plot radius of the horizon (el = 0), in SVG user units. */
export const SKY_R = 90

/**
 * Polar az/el projection for the sky plot: north up, east right, zenith at
 * the centre, r = (90 − el)/90 · R. SVG y grows downward, so north is −y.
 * Elevations below the horizon clamp to the rim.
 */
export function project(azDeg: number, elDeg: number): { x: number; y: number } {
  const r = ((90 - Math.max(elDeg, 0)) / 90) * SKY_R
  const az = (azDeg * Math.PI) / 180
  return { x: r * Math.sin(az), y: -r * Math.cos(az) }
}
