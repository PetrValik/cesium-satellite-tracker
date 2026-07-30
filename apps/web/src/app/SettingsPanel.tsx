/**
 * Color settings: per-domain palettes persisted to localStorage
 * (core/ui/prefsStore), defaults restore via RESET. Colors are edited with a
 * HUD-styled swatch popover instead of input[type=color] — the native OS
 * picker is a white light-mode dialog that breaks the dark MFD illusion.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SHIP_TYPES } from '@orbital-ops/shared'
import { useMode } from '../core/ui/modeStore'
import { usePrefs, type ColorPrefs } from '../core/ui/prefsStore'
import { ORBIT_CLASSES } from '../lib/protocol'

const AIRCRAFT_KEYS = ['civil', 'cargo', 'military'] as const

/**
 * Curated palette: six family columns (amber, cyan, green, red, violet/blue,
 * neutral), four shades per column running bright → dim down the grid.
 * Row-major order, so every row holds one shade of each family. Chosen for
 * legibility against the near-black globe, and every prefsStore
 * DEFAULT_COLORS value appears here so any default is one click away.
 */
const SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  // brightest shades
  { hex: '#ffd166', name: 'GOLD' },
  { hex: '#a8f0ff', name: 'ICE' },
  { hex: '#a3e635', name: 'LIME' },
  { hex: '#ffa1b5', name: 'PINK' },
  { hex: '#c084fc', name: 'VIOLET' }, // default: GEO, passenger ships
  { hex: '#f0f4f8', name: 'WHITE' }, // default: highspeed ships
  // the app's base hues (matches DEFAULT_COLORS)
  { hex: '#ffb454', name: 'AMBER' }, // default: LEO, tanker ships
  { hex: '#6ee7ff', name: 'CYAN' }, // default: MEO, cargo ships
  { hex: '#7dd87d', name: 'GREEN' }, // default: military aircraft, fishing
  { hex: '#ff5f8f', name: 'HOT PINK' },
  { hex: '#4da6ff', name: 'BLUE' }, // default: civil aircraft
  { hex: '#c7d0dc', name: 'SILVER' },
  // saturated alternates
  { hex: '#ff8f3d', name: 'ORANGE' },
  { hex: '#2dd4bf', name: 'TEAL' },
  { hex: '#34d399', name: 'EMERALD' },
  { hex: '#f87171', name: 'RED' }, // default: HEO, military ships, cargo aircraft
  { hex: '#8b5cf6', name: 'IRIS' },
  { hex: '#8a93a3', name: 'GREY' }, // default: other ships
  // dimmed shades for subdued layers
  { hex: '#c27a2e', name: 'DIM AMBER' },
  { hex: '#3a9daf', name: 'DIM CYAN' },
  { hex: '#4e8f4e', name: 'DIM GREEN' },
  { hex: '#b04a4a', name: 'DIM RED' },
  { hex: '#3b6fd4', name: 'DIM BLUE' },
  { hex: '#5c6674', name: 'DIM GREY' },
]

/** Viewport margin and anchor gap for the popover placement. */
const POP_MARGIN = 8
const POP_GAP = 6

function SwatchPopover({
  anchorRef,
  label,
  value,
  onSelect,
  onClose,
}: {
  /** Chip ref, dereferenced only in commit-phase code (react-hooks/refs). */
  anchorRef: RefObject<HTMLButtonElement | null>
  label: string
  value: string
  /** Writes to the store; the popover stays open (hex-field iteration). */
  onSelect: (hex: string) => void
  /** refocus=true returns focus to the chip (ESC / swatch pick). */
  onClose: (refocus: boolean) => void
}) {
  const popRef = useRef<HTMLDivElement | null>(null)
  const current = value.toLowerCase()

  // The draft is tagged with the store value it was typed against; a swatch
  // pick or RESET changes `value`, which invalidates the draft during render
  // (no state-sync effect — react-hooks/set-state-in-effect).
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null)
  const text = draft && draft.base === value ? draft.text : value.toUpperCase()

  // Place on mount via a measuring callback ref: the popover portals to
  // <body> because the settings panel scrolls and its backdrop-filter +
  // clip-path would trap and clip any absolutely positioned child. Prefer
  // below the chip, flip above near the viewport bottom, clamp horizontally.
  // useCallback keeps the ref identity stable so typing in the hex field
  // does not re-run placement (which also focuses the active swatch).
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      popRef.current = node
      const anchor = anchorRef.current
      if (!node || !anchor) return
      const chip = anchor.getBoundingClientRect()
      const self = node.getBoundingClientRect()
      const left = Math.max(
        POP_MARGIN,
        Math.min(chip.right - self.width, window.innerWidth - self.width - POP_MARGIN),
      )
      let top = chip.bottom + POP_GAP
      if (top + self.height > window.innerHeight - POP_MARGIN) {
        top = Math.max(POP_MARGIN, chip.top - self.height - POP_GAP)
      }
      node.style.left = `${left}px`
      node.style.top = `${top}px`
      node.style.visibility = 'visible'
      // move focus in only once visible (hidden elements refuse focus)
      const target =
        node.querySelector<HTMLButtonElement>('[data-selected="true"]') ??
        node.querySelector<HTMLButtonElement>('button')
      target?.focus()
    },
    [anchorRef],
  )

  useEffect(() => {
    const pop = popRef.current
    if (!pop) return
    // ESC closes only the popover: GlobeView's window keydown closes the
    // whole settings dialog on Escape, so stop it at the popover node.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose(true)
    }
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (pop.contains(t) || anchorRef.current?.contains(t)) return
      onClose(false)
    }
    // the popover is fixed while its anchor lives in a scrolling panel —
    // close on scroll/resize rather than float detached from the row
    const onDetach = () => onClose(false)
    pop.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onDetach, true)
    window.addEventListener('resize', onDetach)
    return () => {
      pop.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onDetach, true)
      window.removeEventListener('resize', onDetach)
    }
  }, [anchorRef, onClose])

  // Accepts "#RRGGBB" or bare "RRGGBB"; invalid input reverts to the stored
  // value. Committed lowercase to match DEFAULT_COLORS / persisted prefs.
  const commitHex = () => {
    const match = /^#?([0-9a-f]{6})$/i.exec(text.trim())
    setDraft(null)
    if (match) onSelect(`#${match[1].toLowerCase()}`)
  }

  return createPortal(
    <div ref={place} className="swatch-popover" role="dialog" aria-label={`${label} color picker`}>
      <div className="swatch-grid">
        {SWATCHES.map((s) => {
          const selected = s.hex === current
          return (
            <button
              key={s.hex}
              type="button"
              className={selected ? 'swatch is-selected' : 'swatch'}
              style={{ background: s.hex }}
              data-selected={selected ? 'true' : undefined}
              aria-pressed={selected}
              aria-label={`${s.name} ${s.hex.toUpperCase()}`}
              title={`${s.name} ${s.hex.toUpperCase()}`}
              onClick={() => {
                onSelect(s.hex)
                onClose(true)
              }}
            />
          )
        })}
      </div>
      <input
        className="hud-input swatch-hex"
        value={text}
        maxLength={7}
        spellCheck={false}
        aria-label={`${label} hex value`}
        onChange={(e) => setDraft({ base: value, text: e.target.value })}
        onBlur={commitHex}
        onKeyDown={(e) => e.key === 'Enter' && commitHex()}
      />
    </div>,
    document.body,
  )
}

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
