/**
 * Left-rail content for AIRSPACE mode: live aircraft count, feed age, and
 * altitude-band + category rows that double as globe filters. Colors are
 * unified: category = hue, altitude = shade (see AircraftLayer).
 */
import { formatAge, formatCount } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'
import { AIRCRAFT_CATEGORIES, categoryOf, type AircraftCategory } from './aircraftCategory'
import { usePrefs } from '../../core/ui/prefsStore'
import { ALT_BANDS, bandOf, useAircraft, type AltBand } from './aircraftStore'

const BAND_LABELS: Record<AltBand, string> = {
  ground: 'ON GROUND',
  low: 'BELOW 3 KM',
  mid: '3–9 KM',
  high: 'ABOVE 9 KM',
}

const CATEGORY_LABELS: Record<AircraftCategory, string> = {
  civil: 'CIVIL',
  cargo: 'CARGO',
  military: 'MILITARY',
}

export function AirPicture() {
  const available = useAircraft((s) => s.available)
  const aircraft = useAircraft((s) => s.aircraft)
  const lastPollMs = useAircraft((s) => s.lastPollMs)
  const activeBands = useAircraft((s) => s.activeBands)
  const activeCategories = useAircraft((s) => s.activeCategories)
  const toggleBand = useAircraft((s) => s.toggleBand)
  const toggleCategory = useAircraft((s) => s.toggleCategory)
  const nowMs = useWallClock((s) => s.nowMs)
  const aircraftColors = usePrefs((s) => s.colors.aircraft)

  const countsByBand: Record<AltBand, number> = { ground: 0, low: 0, mid: 0, high: 0 }
  const countsByCategory: Record<AircraftCategory, number> = { civil: 0, cargo: 0, military: 0 }
  for (const a of aircraft) {
    countsByBand[bandOf(a)]++
    countsByCategory[categoryOf(a)]++
  }

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
          <div className="live-count">{formatCount(aircraft.length)} AIRCRAFT LIVE</div>
          {lastPollMs !== null && (
            <div className="live-meta">DATA AGE {formatAge(Math.max(0, nowMs - lastPollMs))}</div>
          )}
          <ul className="group-list">
            {ALT_BANDS.map((band) => (
              <li key={band}>
                <button
                  className={`group-row${activeBands.has(band) ? ' is-active' : ''}`}
                  onClick={() => toggleBand(band)}
                  title="Toggle this altitude band on the globe"
                >
                  <span className={`group-indicator band-${band}`} aria-hidden />
                  <span className="group-name">{BAND_LABELS[band]}</span>
                  <span className="group-count">{formatCount(countsByBand[band])}</span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="group-list">
            {AIRCRAFT_CATEGORIES.map((category) => (
              <li key={category}>
                <button
                  className={`group-row${activeCategories.has(category) ? ' is-active' : ''}`}
                  onClick={() => toggleCategory(category)}
                  title="Toggle this category on the globe (heuristic classification)"
                >
                  <span
                    className="group-indicator"
                    style={
                      activeCategories.has(category)
                        ? { background: aircraftColors[category], borderColor: aircraftColors[category] }
                        : undefined
                    }
                    aria-hidden
                  />
                  <span className="group-name">{CATEGORY_LABELS[category]}</span>
                  <span className="group-count">{formatCount(countsByCategory[category])}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
