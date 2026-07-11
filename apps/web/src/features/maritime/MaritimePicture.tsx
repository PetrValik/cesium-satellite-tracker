import type { ShipType } from '@orbital-ops/shared'
import { formatCount } from '../../lib/format'
import { useShips } from './shipsStore'

const SHIP_TYPE_ORDER: { type: ShipType; label: string }[] = [
  { type: 'cargo', label: 'CARGO' },
  { type: 'tanker', label: 'TANKER' },
  { type: 'passenger', label: 'PASSENGER' },
  { type: 'fishing', label: 'FISHING' },
  { type: 'highspeed', label: 'HIGH-SPEED' },
  { type: 'other', label: 'OTHER' },
]

/** Left-rail content for MARITIME mode: live vessel counts by type. */
export function MaritimePicture() {
  const configured = useShips((s) => s.configured)
  const countsByType = useShips((s) => s.countsByType)
  const total = useShips((s) => s.ships.length)

  return (
    <>
      <h2 className="hud-title">MARITIME PICTURE</h2>
      {configured === false && (
        <div className="passes-empty">
          AIS OFFLINE — REGISTER AT AISSTREAM.IO AND SET AISSTREAM_API_KEY FOR THE API
        </div>
      )}
      {configured === null && <div className="passes-empty">CONNECTING…</div>}
      {configured === true && (
        <>
          <div className="live-count">{formatCount(total)} VESSELS LIVE</div>
          <ul className="group-list">
            {SHIP_TYPE_ORDER.map(({ type, label }) => (
              <li key={type}>
                <div className="group-row is-active">
                  <span className={`group-indicator ship-${type}`} aria-hidden />
                  <span className="group-name">{label}</span>
                  <span className="group-count">{formatCount(countsByType[type] ?? 0)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
