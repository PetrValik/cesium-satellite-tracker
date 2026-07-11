import { useMode } from '../core/ui/modeStore'
import { BASEMAPS, usePrefs, type Basemap } from '../core/ui/prefsStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useShips } from '../features/maritime/shipsStore'
import { formatCount } from '../lib/format'
import launchSites from '../data/launchSites.json'
import ports from '../data/ports.json'

/**
 * Globe layer toggles, shown in every mode. Lives in the app layer because
 * it spans all domains (visibility state itself is core/ui).
 */
export function LayersPanel() {
  const launchSitesOn = useMode((s) => s.launchSites)
  const portsOn = useMode((s) => s.ports)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  const toggleLaunchSites = useMode((s) => s.toggleLaunchSites)
  const togglePorts = useMode((s) => s.togglePorts)
  const toggleShips = useMode((s) => s.toggleShips)
  const toggleAircraft = useMode((s) => s.toggleAircraft)
  const shipCount = useShips((s) => s.ships.length)
  const aircraftCount = useAircraft((s) => s.aircraft.length)

  const rows: {
    key: string
    label: string
    count: number
    on: boolean
    toggle: () => void
    indicatorClass?: string
  }[] = [
    {
      key: 'ships',
      label: 'VESSELS',
      count: shipCount,
      on: shipsOn,
      toggle: toggleShips,
      indicatorClass: ' ship-cargo',
    },
    {
      key: 'aircraft',
      label: 'AIRCRAFT',
      count: aircraftCount,
      on: aircraftOn,
      toggle: toggleAircraft,
      indicatorClass: ' ship-highspeed',
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
      indicatorClass: ' infra-port',
    },
  ]

  const basemap = usePrefs((s) => s.basemap)
  const setBasemap = usePrefs((s) => s.setBasemap)
  const basemapLabels: Record<Basemap, string> = {
    streets: 'MAP',
    topo: 'TOPO',
    satellite: 'SAT',
  }

  return (
    <>
      <h2 className="hud-title infra-title">LAYERS</h2>
      <div className="color-mode-row">
        <span className="color-mode-label">BASEMAP</span>
        {BASEMAPS.map((b) => (
          <button
            key={b}
            className={`hud-button${b === basemap ? ' is-active' : ''}`}
            onClick={() => setBasemap(b)}
          >
            {basemapLabels[b]}
          </button>
        ))}
      </div>
      <ul className="group-list">
        {rows.map((row) => (
          <li key={row.key}>
            <button className={`group-row${row.on ? ' is-active' : ''}`} onClick={row.toggle}>
              <span className={`group-indicator${row.indicatorClass ?? ''}`} aria-hidden />
              <span className="group-name">{row.label}</span>
              <span className="group-count">{formatCount(row.count)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
