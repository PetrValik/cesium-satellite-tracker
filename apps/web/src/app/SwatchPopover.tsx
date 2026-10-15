/**
 * HUD-styled colour picker for one COLORS row: the curated swatch grid plus
 * a hex field, portalled to <body> and placed against its chip. Replaces
 * input[type=color] — the native OS picker is a white light-mode dialog that
 * breaks the dark MFD illusion.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SWATCHES } from './swatches'

/** Viewport margin and anchor gap for the popover placement. */
const POP_MARGIN = 8
const POP_GAP = 6

export function SwatchPopover({
  anchorRef,
  label,
  fieldName,
  value,
  onSelect,
  onClose,
}: {
  /** Chip ref, dereferenced only in commit-phase code (react-hooks/refs). */
  anchorRef: RefObject<HTMLButtonElement | null>
  label: string
  /** `name` of the hex field — DevTools flags a form field with neither id nor name. */
  fieldName: string
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
      // Clamp against what is actually on screen: on a pinch-zoomed or
      // URL-bar-squeezed phone the visual viewport is smaller than (and
      // offset inside) the layout viewport that innerWidth/innerHeight report.
      const vv = window.visualViewport
      const viewLeft = vv?.offsetLeft ?? 0
      const viewTop = vv?.offsetTop ?? 0
      const viewRight = viewLeft + (vv?.width ?? window.innerWidth)
      const viewBottom = viewTop + (vv?.height ?? window.innerHeight)
      const left = Math.max(
        viewLeft + POP_MARGIN,
        Math.min(chip.right - self.width, viewRight - self.width - POP_MARGIN),
      )
      let top = chip.bottom + POP_GAP
      if (top + self.height > viewBottom - POP_MARGIN) {
        top = Math.max(viewTop + POP_MARGIN, chip.top - self.height - POP_GAP)
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
    // ESC closes only the popover: the globe's window keydown
    // (app/globe/globeKeys.ts) closes the whole settings dialog on Escape,
    // so stop it at the popover node.
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
        name={fieldName}
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
