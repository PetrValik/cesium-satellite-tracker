import { isDomainVisible, OPS_MODES, useMode, type OpsMode } from '../core/ui/modeStore'

const LABELS: Record<OpsMode, string> = {
  orbital: 'ORBITAL',
  maritime: 'MARITIME',
  airspace: 'AIRSPACE',
}

function ModeTab({ mode }: { mode: OpsMode }) {
  const visible = useMode((s) => isDomainVisible(s, mode))
  const toggleDomain = useMode((s) => s.toggleDomain)
  return (
    <button
      className={`hud-button mode-tab${visible ? ' is-active' : ''}`}
      aria-pressed={visible}
      onClick={() => toggleDomain(mode)}
    >
      {LABELS[mode]}
    </button>
  )
}

/**
 * Domain toggles: each tab shows/hides one domain's layer (amber = visible,
 * dim = hidden) and any subset may be on at once. Enabling a domain also
 * focuses its panels; hiding one clears its selection via the mode
 * subscription in app/globe/layerSync.ts (`deselectInMode`), so no
 * tab-side cleanup is needed here.
 */
export function ModeTabs() {
  return (
    <nav className="mode-tabs" aria-label="Domain layers">
      {OPS_MODES.map((m) => (
        <ModeTab key={m} mode={m} />
      ))}
    </nav>
  )
}
