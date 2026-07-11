/** Top status strip: brand, tracked-object count, TLE age, sim state. Read-only HUD. */
import { useSimClock } from '../core/sim/simClock'
import { useCatalog } from '../features/catalog/catalogStore'
import { formatAge, formatCount, formatRate } from '../lib/format'
import { useWallClock } from '../lib/wallClock'

export function StatusLine() {
  const satCount = useCatalog((s) => s.sats.length)
  const offline = useCatalog((s) => s.offline)
  const groups = useCatalog((s) => s.groups)
  const activeSlugs = useCatalog((s) => s.activeSlugs)
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
      <span className="status-item">TRACKING {formatCount(satCount)} OBJECTS</span>
      {oldest !== null && <span className="status-item">TLE AGE {formatAge(nowMs - oldest)}</span>}
      <span className="status-item">SIM {playing ? formatRate(rate) : 'HOLD'}</span>
      {offline && <span className="status-item status-offline">OFFLINE — CACHED DATA</span>}
    </header>
  )
}
