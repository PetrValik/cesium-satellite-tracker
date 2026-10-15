import { useMode } from '../core/ui/modeStore'
import { BASEMAPS, usePrefs, type Basemap } from '../core/ui/prefsStore'
import { useSimLive } from '../core/sim/simLive'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import { formatCount } from '../lib/format'
import launchSites from '../data/launchSites.json'
import ports from '../data/ports.json'

const BASEMAP_LABELS: Record<Basemap, string> = {
  streets: 'MAP',
  topo: 'TOPO',
  satellite: 'SAT',
}

interface LayerRow {
  key: string
  label: string
  count: number
  on: boolean
  toggle: () => void
  /** Layer identity hue for the row's indicator (index.css .layer-*). */
  indicatorClass?: string
  suspended?: boolean
}

/**
 * Globe layer toggles, shown in every mode. Lives in the app layer because
 * it spans all domains (visibility state itself is core/ui). The three
 * domain rows go through toggleLayer: hiding the focused domain moves focus
 * on, exactly like its tab, but showing one never steals focus.
 */
export function LayersPanel() {
  const launchSitesOn = useMode((s) => s.launchSites)
  const portsOn = useMode((s) => s.ports)
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  const toggleLaunchSites = useMode((s) => s.toggleLaunchSites)
  const togglePorts = useMode((s) => s.togglePorts)
  const toggleLayer = useMode((s) => s.toggleLayer)
  const satCount = useCatalog((s) => s.sats.length)
  const shipCount = useShips((s) => s.ships.length)
  const aircraftCount = useAircraft((s) => s.aircraft.length)
  // Live layers suspend while sim time is warped away from NOW — reflect
  // that here so a toggled-on-but-empty globe isn't mysterious.
  const simLive = useSimLive()
  const basemap = usePrefs((s) => s.basemap)
  const setBasemap = usePrefs((s) => s.setBasemap)

  const rows: LayerRow[] = [
    {
      key: 'satellites',
      label: 'SATELLITES',
      count: satCount,
      on: satellitesOn,
      toggle: () => toggleLayer('orbital'),
    },
    {
      key: 'ships',
      label: 'VESSELS',
      count: shipCount,
      on: shipsOn,
      toggle: () => toggleLayer('maritime'),
      indicatorClass: 'layer-ships',
      suspended: !simLive,
    },
    {
      key: 'aircraft',
      label: 'AIRCRAFT',
      count: aircraftCount,
      on: aircraftOn,
      toggle: () => toggleLayer('airspace'),
      indicatorClass: 'layer-aircraft',
      suspended: !simLive,
    },
    {
      key: 'launch-sites',
      label: 'LAUNCH SITES',
      count: launchSites.length,
      on: launchSitesOn,
      toggle: toggleLaunchSites,
    },
    {
      key: 'ports',
      label: 'MAJOR PORTS',
      count: ports.length,
      on: portsOn,
      toggle: togglePorts,
      indicatorClass: 'layer-ports',
    },
  ]

  return (
    <>
      <h2 className="hud-title infra-title">LAYERS</h2>
      <div className="basemap-row">
        <span className="basemap-label">BASEMAP</span>
        {BASEMAPS.map((b) => (
          <button
            key={b}
            className={`hud-button${b === basemap ? ' is-active' : ''}`}
            onClick={() => setBasemap(b)}
          >
            {BASEMAP_LABELS[b]}
          </button>
        ))}
      </div>
      <ul className="group-list">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              className={`group-row${row.on ? ' is-active' : ''}${row.suspended ? ' is-suspended' : ''}`}
              onClick={row.toggle}
              title={row.suspended ? 'Live feed suspended while sim time is off NOW' : undefined}
            >
              <span
                className={row.indicatorClass ? `group-indicator ${row.indicatorClass}` : 'group-indicator'}
                aria-hidden
              />
              <span className="group-name">{row.label}</span>
              <span className="group-count">{row.suspended ? 'SUSP' : formatCount(row.count)}</span>
            </button>
          </li>
        ))}
      </ul>
      {/* the SUSP reason is a title tooltip on desktop; touch has no hover,
          so a visible legend line stands in (index.css .touch-legend) */}
      {rows.some((row) => row.suspended) && (
        <p className="touch-legend">SUSP · LIVE FEEDS PAUSED WHILE SIM TIME IS OFF NOW</p>
      )}
    </>
  )
}
