import { OPS_MODES, useMode, type OpsMode } from '../core/ui/modeStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'

const LABELS: Record<OpsMode, string> = {
  orbital: 'ORBITAL',
  maritime: 'MARITIME',
  airspace: 'AIRSPACE',
}

/** MFD-style domain selector: switches which catalog/tracking UI is shown. */
export function ModeTabs() {
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)

  const switchTo = (m: OpsMode) => {
    if (m === mode) return
    // A manual tab switch starts the new domain with a clean slate — cross-
    // domain picking (which selects AFTER setting the mode) is unaffected.
    useCatalog.getState().select(null)
    useShips.getState().select(null)
    useAircraft.getState().select(null)
    setMode(m)
  }

  return (
    <nav className="mode-tabs" aria-label="Ops mode">
      {OPS_MODES.map((m) => (
        <button
          key={m}
          className={`hud-button mode-tab${m === mode ? ' is-active' : ''}`}
          onClick={() => switchTo(m)}
        >
          {LABELS[m]}
        </button>
      ))}
    </nav>
  )
}
