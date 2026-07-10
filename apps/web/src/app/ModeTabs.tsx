import { OPS_MODES, useMode, type OpsMode } from '../core/ui/modeStore'

const LABELS: Record<OpsMode, string> = {
  orbital: 'ORBITAL',
  maritime: 'MARITIME',
  airspace: 'AIRSPACE',
}

/** MFD-style domain selector: switches which catalog/tracking UI is shown. */
export function ModeTabs() {
  const mode = useMode((s) => s.mode)
  const setMode = useMode((s) => s.setMode)
  return (
    <nav className="mode-tabs" aria-label="Ops mode">
      {OPS_MODES.map((m) => (
        <button
          key={m}
          className={`hud-button mode-tab${m === mode ? ' is-active' : ''}`}
          onClick={() => setMode(m)}
        >
          {LABELS[m]}
        </button>
      ))}
    </nav>
  )
}
