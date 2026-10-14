/**
 * Top status strip: brand, tracked-object count, TLE age, sim state. Read-only HUD.
 * The compact layout hides TLE AGE / SIM on narrow phones and the `status-long`
 * spans (index.css); the inline spans render identically on desktop.
 */
import { useSimClock } from '../core/sim/simClock'
import { useMode } from '../core/ui/modeStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { formatAge, formatCount, formatRate } from '../lib/format'
import { useWallClock } from '../lib/wallClock'

export function StatusLine() {
  const satCount = useCatalog((s) => s.sats.length)
  const offline = useCatalog((s) => s.offline)
  const groups = useCatalog((s) => s.groups)
  const activeSlugs = useCatalog((s) => s.activeSlugs)
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const rate = useSimClock((s) => s.rate)
  const playing = useSimClock((s) => s.playing)
  const nowMs = useWallClock((s) => s.nowMs)

  const updatedTimes = groups
    .filter((g) => activeSlugs.includes(g.slug) && g.updatedAt !== null)
    .map((g) => Date.parse(g.updatedAt!))
  const oldest = updatedTimes.length > 0 ? Math.min(...updatedTimes) : null

  return (
    <header className="status-line">
      <span className="status-brand">ORBITAL OPS</span>
      <span className="status-item status-count">
        <span className="status-long">TRACKING </span>
        {formatCount(satCount)} OBJECTS
      </span>
      {oldest !== null && (
        <span className="status-item status-tle">TLE AGE {formatAge(nowMs - oldest)}</span>
      )}
      {/* Sim-time readout travels with the ORBITAL layer, like the transport bar. */}
      {satellitesOn && (
        <span className="status-item status-sim">SIM {playing ? formatRate(rate) : 'HOLD'}</span>
      )}
      {/* The offline badge is the one safety-relevant readout: on phones it
          jumps ahead of the count (CSS order) and drops to its short form. */}
      {offline && (
        <span className="status-item status-offline" role="status">
          OFFLINE<span className="status-long"> — CACHED DATA</span>
        </span>
      )}
    </header>
  )
}
