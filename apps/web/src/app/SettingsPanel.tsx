/**
 * Color settings: per-domain palettes with live pickers, persisted to
 * localStorage (core/ui/prefsStore). Defaults restore via RESET.
 */
import { SHIP_TYPES } from '@orbital-ops/shared'
import { useMode } from '../core/ui/modeStore'
import { usePrefs, type ColorPrefs } from '../core/ui/prefsStore'
import { ORBIT_CLASSES } from '../lib/protocol'

const AIRCRAFT_KEYS = ['civil', 'cargo', 'military'] as const

function ColorRow({
  domain,
  colorKey,
  label,
}: {
  domain: keyof ColorPrefs
  colorKey: string
  label: string
}) {
  const value = usePrefs((s) => (s.colors[domain] as Record<string, string>)[colorKey])
  const setColor = usePrefs((s) => s.setColor)
  return (
    <label className="color-row">
      <span className="color-row-label">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => setColor(domain, colorKey, e.target.value)}
      />
    </label>
  )
}

export function SettingsPanel() {
  const open = useMode((s) => s.settingsOpen)
  const close = useMode((s) => s.closeSettings)
  const resetColors = usePrefs((s) => s.resetColors)
  if (!open) return null

  return (
    <div className="help-backdrop" onClick={close} role="presentation">
      <section
        className="hud-panel help-panel settings-panel"
        role="dialog"
        aria-label="Color settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="telemetry-header">
          <h2 className="hud-title">COLORS</h2>
          <span className="panel-actions">
            <button className="hud-button" onClick={resetColors} title="Restore defaults">
              RESET
            </button>
            <button className="hud-button" onClick={close} title="Close">
              ✕
            </button>
          </span>
        </header>

        <div className="help-section">
          <h3 className="help-section-title">AIRCRAFT (HUE BY CATEGORY, SHADE BY ALTITUDE)</h3>
          <div className="color-grid">
            {AIRCRAFT_KEYS.map((key) => (
              <ColorRow key={key} domain="aircraft" colorKey={key} label={key.toUpperCase()} />
            ))}
          </div>
        </div>

        <div className="help-section">
          <h3 className="help-section-title">VESSELS (BY AIS TYPE)</h3>
          <div className="color-grid">
            {SHIP_TYPES.map((type) => (
              <ColorRow key={type} domain="ships" colorKey={type} label={type.toUpperCase()} />
            ))}
          </div>
        </div>

        <div className="help-section">
          <h3 className="help-section-title">SATELLITES (BY ORBIT CLASS)</h3>
          <div className="color-grid">
            {ORBIT_CLASSES.map((cls) => (
              <ColorRow key={cls} domain="satellites" colorKey={cls} label={cls} />
            ))}
          </div>
        </div>

        <p className="help-footnote">
          Saved to this browser (localStorage), together with your last camera position.
        </p>
      </section>
    </div>
  )
}

/** Launcher pinned next to the HELP button. */
export function SettingsButton() {
  const toggle = useMode((s) => s.toggleSettings)
  return (
    <button className="hud-button settings-button" onClick={toggle} title="Color settings">
      ⚙ COLORS
    </button>
  )
}
