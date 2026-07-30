/**
 * Left-rail content for MARITIME mode: live vessel totals broken down by
 * AIS type. The type rows are filter toggles — switching one off hides
 * those vessels on the globe.
 */
import type { ShipType } from '@orbital-ops/shared'
import { formatCount } from '../../lib/format'
import { usePrefs } from '../../core/ui/prefsStore'
import { useSimLive } from '../../core/sim/simLive'
import { useShips } from './shipsStore'

const SHIP_TYPE_ORDER: { type: ShipType; label: string }[] = [
  { type: 'cargo', label: 'CARGO' },
  { type: 'tanker', label: 'TANKER' },
  { type: 'passenger', label: 'PASSENGER' },
  { type: 'fishing', label: 'FISHING' },
  { type: 'highspeed', label: 'HIGH-SPEED' },
  { type: 'military', label: 'MILITARY' },
  { type: 'other', label: 'OTHER' },
]

/** Left-rail content for MARITIME mode: live vessel counts by type. */
export function MaritimePicture() {
  const configured = useShips((s) => s.configured)
  const countsByType = useShips((s) => s.countsByType)
  const total = useShips((s) => s.ships.length)
  const activeTypes = useShips((s) => s.activeTypes)
  const toggleType = useShips((s) => s.toggleType)
  const shipColors = usePrefs((s) => s.colors.ships)
  // Vessels dead-reckon on wall time, so the layer hides while sim time is
  // warped away from NOW — say so instead of showing a misleading count.
  const simLive = useSimLive()

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
          {simLive ? (
            <div className="live-count">{formatCount(total)} VESSELS LIVE</div>
          ) : (
            <div className="live-count live-suspended">SUSPENDED — TIME WARP</div>
          )}
          <ul className="group-list">
            {SHIP_TYPE_ORDER.map(({ type, label }) => (
              <li key={type}>
                <button
                  className={`group-row${activeTypes.has(type) ? ' is-active' : ''}`}
                  onClick={() => toggleType(type)}
                  title="Toggle this vessel type on the globe"
                >
                  <span
                    className="group-indicator"
                    style={
                      activeTypes.has(type)
                        ? { background: shipColors[type], borderColor: shipColors[type] }
                        : undefined
                    }
                    aria-hidden
                  />
                  <span className="group-name">{label}</span>
                  <span className="group-count">{formatCount(countsByType[type] ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
