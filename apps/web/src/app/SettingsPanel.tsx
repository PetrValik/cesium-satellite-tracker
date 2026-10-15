/**
 * Color settings: per-domain palettes persisted to localStorage
 * (core/ui/prefsStore), defaults restore via RESET. Each row's chip opens
 * the HUD-styled swatch popover (app/SwatchPopover).
 */
import { useCallback, useRef, useState } from 'react'
import { SHIP_TYPES } from '@orbital-ops/shared'
import { useMode } from '../core/ui/modeStore'
import { usePrefs, type ColorPrefs } from '../core/ui/prefsStore'
import { AIRCRAFT_CATEGORIES } from '../lib/aircraftCategories'
import { ORBIT_CLASSES } from '../lib/protocol'
import { HudDialog } from './HudDialog'
import { SwatchPopover } from './SwatchPopover'

function ColorRow({
  domain,
  colorKey,
  label,
  openPicker,
  setOpenPicker,
}: {
  domain: keyof ColorPrefs
  colorKey: string
  label: string
  openPicker: string | null
  setOpenPicker: (id: string | null) => void
}) {
  const id = `${domain}.${colorKey}`
  const open = openPicker === id
  const value = usePrefs((s) => (s.colors[domain] as Record<string, string>)[colorKey])
  const setColor = usePrefs((s) => s.setColor)
  const chipRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(
    (refocus: boolean) => {
      setOpenPicker(null)
      if (refocus) chipRef.current?.focus()
    },
    [setOpenPicker],
  )

  return (
    <div className="color-row">
      <span className="color-row-label">{label}</span>
      <button
        ref={chipRef}
        type="button"
        className="color-chip"
        style={{ background: value }}
        title={value.toUpperCase()}
        aria-label={`${label} color ${value.toUpperCase()}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpenPicker(open ? null : id)}
      />
      {open && (
        <SwatchPopover
          anchorRef={chipRef}
          label={label}
          fieldName={`color-${domain}-${colorKey}-hex`}
          value={value}
          onSelect={(hex) => setColor(domain, colorKey, hex)}
          onClose={close}
        />
      )}
    </div>
  )
}

export function SettingsPanel() {
  const open = useMode((s) => s.settingsOpen)
  if (!open) return null
  // dialog is a separate component so the open-picker state unmounts with it
  return <SettingsDialog />
}

function SettingsDialog() {
  const close = useMode((s) => s.closeSettings)
  const resetColors = usePrefs((s) => s.resetColors)
  // one popover open at a time across all rows, keyed "domain.colorKey"
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const rowProps = { openPicker, setOpenPicker }

  return (
    <HudDialog
      label="Color settings"
      title="COLORS"
      hook="settings-panel"
      onClose={close}
      closeLabel="Close colors"
      actions={
        // the visible RESET is the accessible name (WCAG 2.5.3 label in
        // name — voice users say what they see); title only describes
        <button className="hud-button" onClick={resetColors} title="Reset all colors to defaults">
          RESET
        </button>
      }
    >
      <div className="help-section">
        <h3 className="help-section-title">AIRCRAFT (HUE BY CATEGORY, SHADE BY ALTITUDE)</h3>
        <div className="color-grid">
          {AIRCRAFT_CATEGORIES.map((key) => (
            <ColorRow
              key={key}
              domain="aircraft"
              colorKey={key}
              label={key.toUpperCase()}
              {...rowProps}
            />
          ))}
        </div>
      </div>

      <div className="help-section">
        <h3 className="help-section-title">VESSELS (BY AIS TYPE)</h3>
        <div className="color-grid">
          {SHIP_TYPES.map((type) => (
            <ColorRow
              key={type}
              domain="ships"
              colorKey={type}
              label={type.toUpperCase()}
              {...rowProps}
            />
          ))}
        </div>
      </div>

      <div className="help-section">
        <h3 className="help-section-title">SATELLITES (BY ORBIT CLASS)</h3>
        <div className="color-grid">
          {ORBIT_CLASSES.map((cls) => (
            <ColorRow key={cls} domain="satellites" colorKey={cls} label={cls} {...rowProps} />
          ))}
        </div>
      </div>

      <p className="help-footnote">
        Saved to this browser (localStorage), together with your last camera position.
      </p>
    </HudDialog>
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
