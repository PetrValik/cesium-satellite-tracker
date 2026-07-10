import type { PassPrediction } from '../../lib/protocol'

const R = 90 // plot radius for el = 0 (horizon)

/** Polar az/el projection: N up, E right, zenith at center. */
function project(azDeg: number, elDeg: number): { x: number; y: number } {
  const r = ((90 - Math.max(elDeg, 0)) / 90) * R
  const az = (azDeg * Math.PI) / 180
  return { x: r * Math.sin(az), y: -r * Math.cos(az) }
}

export interface SkyPlotProps {
  pass: PassPrediction
  /** Sim time; a live marker is drawn when it falls inside the pass. */
  epochMs?: number
}

export function SkyPlot({ pass, epochMs }: SkyPlotProps) {
  const points = pass.samples
    .filter((s) => s.elDeg >= 0)
    .map((s) => project(s.azDeg, s.elDeg))
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  const first = points[0]
  const last = points[points.length - 1]

  let live: { x: number; y: number } | null = null
  if (epochMs !== undefined && epochMs >= pass.aosMs && epochMs <= pass.losMs) {
    let nearest = pass.samples[0]
    for (const s of pass.samples) {
      if (Math.abs(s.tMs - epochMs) < Math.abs(nearest!.tMs - epochMs)) nearest = s
    }
    if (nearest) live = project(nearest.azDeg, nearest.elDeg)
  }

  return (
    <svg className="sky-plot" viewBox="-110 -110 220 220" role="img" aria-label="Pass sky plot">
      {/* elevation rings: horizon, 30°, 60° */}
      {[0, 30, 60].map((el) => (
        <circle key={el} className="sky-ring" cx={0} cy={0} r={((90 - el) / 90) * R} />
      ))}
      {/* cardinal cross */}
      <line className="sky-ring" x1={-R} y1={0} x2={R} y2={0} />
      <line className="sky-ring" x1={0} y1={-R} x2={0} y2={R} />
      <text className="sky-label" x={0} y={-R - 6} textAnchor="middle">N</text>
      <text className="sky-label" x={R + 8} y={4} textAnchor="middle">E</text>
      <text className="sky-label" x={0} y={R + 12} textAnchor="middle">S</text>
      <text className="sky-label" x={-R - 8} y={4} textAnchor="middle">W</text>

      {path && <path className="sky-track" d={path} />}
      {first && <circle className="sky-aos" cx={first.x} cy={first.y} r={3} />}
      {last && <rect className="sky-los" x={last.x - 2.6} y={last.y - 2.6} width={5.2} height={5.2} />}
      {live && <circle className="sky-live" cx={live.x} cy={live.y} r={4} />}
    </svg>
  )
}
