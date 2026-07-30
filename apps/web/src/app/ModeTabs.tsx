import { OPS_MODES, useMode, type OpsMode } from '../core/ui/modeStore'

const LABELS: Record<OpsMode, string> = {
  orbital: 'ORBITAL',
  maritime: 'MARITIME',
  airspace: 'AIRSPACE',
}

/**
 * Domain toggles: each tab shows/hides one domain's layer (amber = visible,
 * dim = hidden) and any subset may be on at once. Enabling a domain also
 * focuses its panels; hiding one clears its selection via the GlobeView
 * mode subscription, so no tab-side cleanup is needed here.
 */
export function ModeTabs() {
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  const toggleDomain = useMode((s) => s.toggleDomain)
  const visible: Record<OpsMode, boolean> = {
    orbital: satellitesOn,
    maritime: shipsOn,
    airspace: aircraftOn,
  }

  return (
    <nav className="mode-tabs" aria-label="Domain layers">
      {OPS_MODES.map((m) => (
        <button
          key={m}
          className={`hud-button mode-tab${visible[m] ? ' is-active' : ''}`}
          aria-pressed={visible[m]}
          onClick={() => toggleDomain(m)}
        >
          {LABELS[m]}
        </button>
      ))}
    </nav>
  )
}
