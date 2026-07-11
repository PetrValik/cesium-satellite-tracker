import { FollowButton } from '../../core/ui/FollowButton'
import { formatAge, formatDeg, formatLatLon } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'
import { useAircraft } from './aircraftStore'

const MS_TO_KN = 1.94384

/** Info panel for the selected aircraft (live ADS-B data, wall-clock based). */
export function AircraftPanel() {
  const selectedIcao = useAircraft((s) => s.selectedIcao)
  const aircraft = useAircraft((s) =>
    s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao),
  )
  const select = useAircraft((s) => s.select)
  const nowMs = useWallClock((s) => s.nowMs)

  if (selectedIcao === null) return null

  return (
    <section className="hud-panel telemetry-panel">
      <header className="telemetry-header">
        <h2 className="hud-title">AIRCRAFT</h2>
        <span className="panel-actions">
          <FollowButton />
          <button className="hud-button" onClick={() => select(null)} title="Deselect (Esc)">
            ✕
          </button>
        </span>
      </header>
      <div className="telemetry-name">{aircraft?.callsign || selectedIcao.toUpperCase()}</div>
      {aircraft ? (
        <dl className="telemetry-grid">
          <dt>ICAO24</dt>
          <dd>{aircraft.icao24.toUpperCase()}</dd>
          <dt>ALT</dt>
          <dd>{aircraft.onGround ? 'GROUND' : aircraft.altM === null ? '—' : `${Math.round(aircraft.altM)} M`}</dd>
          <dt>GS</dt>
          <dd>{aircraft.velocityMs === null ? '—' : `${Math.round(aircraft.velocityMs * MS_TO_KN)} KN`}</dd>
          <dt>TRK</dt>
          <dd>{aircraft.trackDeg === null ? '—' : formatDeg(aircraft.trackDeg, 0)}</dd>
          <dt>V/S</dt>
          <dd>
            {aircraft.verticalRateMs === null ? '—' : `${aircraft.verticalRateMs > 0 ? '+' : ''}${aircraft.verticalRateMs.toFixed(1)} M/S`}
          </dd>
          <dt>POS</dt>
          <dd>{formatLatLon(aircraft.latDeg, aircraft.lonDeg)}</dd>
          <dt>REPORT</dt>
          <dd>{formatAge(Math.max(0, nowMs - aircraft.tsMs))} AGO</dd>
        </dl>
      ) : (
        <div className="passes-empty">SIGNAL LOST — AIRCRAFT AGED OUT OF THE FEED</div>
      )}
    </section>
  )
}
