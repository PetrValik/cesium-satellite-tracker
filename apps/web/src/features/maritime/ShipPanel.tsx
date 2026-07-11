import { FollowButton } from '../../core/ui/FollowButton'
import { formatAge, formatDeg, formatLatLon } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'
import { useShips } from './shipsStore'

/** Info panel for the selected vessel (live AIS data, wall-clock based). */
export function ShipPanel() {
  const selectedMmsi = useShips((s) => s.selectedMmsi)
  const ship = useShips((s) => (s.selectedMmsi === null ? undefined : s.byMmsi.get(s.selectedMmsi)))
  const select = useShips((s) => s.select)
  const nowMs = useWallClock((s) => s.nowMs)

  if (selectedMmsi === null) return null

  return (
    <section className="hud-panel telemetry-panel">
      <header className="telemetry-header">
        <h2 className="hud-title">VESSEL</h2>
        <span className="panel-actions">
          <FollowButton />
          <button className="hud-button" onClick={() => select(null)} title="Deselect (Esc)">
            ✕
          </button>
        </span>
      </header>
      <div className="telemetry-name">{ship?.name || `MMSI ${selectedMmsi}`}</div>
      {ship ? (
        <dl className="telemetry-grid">
          <dt>MMSI</dt>
          <dd>{ship.mmsi}</dd>
          <dt>TYPE</dt>
          <dd className={`ship-type ship-${ship.shipType}`}>{ship.shipType.toUpperCase()}</dd>
          <dt>SOG</dt>
          <dd>{ship.sogKn.toFixed(1)} KN</dd>
          <dt>COG</dt>
          <dd>{formatDeg(ship.cogDeg, 0)}</dd>
          <dt>POS</dt>
          <dd>{formatLatLon(ship.latDeg, ship.lonDeg)}</dd>
          <dt>REPORT</dt>
          <dd>{formatAge(Math.max(0, nowMs - ship.tsMs))} AGO</dd>
        </dl>
      ) : (
        <div className="passes-empty">SIGNAL LOST — VESSEL AGED OUT OF THE FEED</div>
      )}
    </section>
  )
}
