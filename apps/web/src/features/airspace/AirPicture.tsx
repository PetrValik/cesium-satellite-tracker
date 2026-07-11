import { formatAge, formatCount } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'
import { useAircraft } from './aircraftStore'

/** Left-rail content for AIRSPACE mode: live aircraft count + feed age. */
export function AirPicture() {
  const available = useAircraft((s) => s.available)
  const total = useAircraft((s) => s.aircraft.length)
  const lastPollMs = useAircraft((s) => s.lastPollMs)
  const nowMs = useWallClock((s) => s.nowMs)

  return (
    <>
      <h2 className="hud-title">AIR PICTURE</h2>
      {available === false && (
        <div className="passes-empty">
          ADS-B OFFLINE — OPENSKY UNREACHABLE (OPTIONAL OPENSKY_CLIENT_ID SPEEDS UP POLLING)
        </div>
      )}
      {available === null && <div className="passes-empty">CONNECTING…</div>}
      {available === true && (
        <>
          <div className="live-count">{formatCount(total)} AIRCRAFT LIVE</div>
          {lastPollMs !== null && (
            <div className="live-meta">DATA AGE {formatAge(Math.max(0, nowMs - lastPollMs))}</div>
          )}
        </>
      )}
    </>
  )
}
