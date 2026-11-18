/**
 * HUD-styled colour picker for one COLORS row: the curated swatch grid plus
 * a hex field, rendered inline in the dialog's colour grid, under the row
 * pair of the chip that opened it. Replaces input[type=color] — the native
 * OS picker is a white light-mode dialog that breaks the dark MFD illusion.
 *
 * Inline, not portalled: the old fixed popover closed on any scroll or
 * resize, and the phone's soft keyboard resizes the viewport the moment the
 * hex field takes focus, so no key ever landed. This picker listens to
 * nothing on window or document; it closes on a swatch pick, Escape, the
 * chip again, or another row's chip.
 */
import { useCallback, useState, type KeyboardEvent } from 'react'
import { parseHexInput, SWATCHES } from './swatches'

export function SwatchPicker({
  id,
  label,
  fieldName,
  value,
  onSelect,
  onClose,
}: {
  /** DOM id; the chip's aria-controls points here. */
  id: string
  /** Row label, e.g. "CARGO". */
  label: string
  /** `name` of the hex field — DevTools flags a form field with neither id nor name. */
  fieldName: string
  /** Stored #rrggbb. */
  value: string
  /** Writes to the store; the picker stays open (hex-field iteration). */
  onSelect: (hex: string) => void
  /** The caller closes the picker and returns focus to the chip. */
  onClose: () => void
}) {
  const current = value.toLowerCase()

  // The draft is tagged with the store value it was typed against; a swatch
  // pick or RESET changes `value`, which invalidates the draft during render
  // (no state-sync effect — react-hooks/set-state-in-effect).
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null)
  const text = draft && draft.base === value ? draft.text : value.toUpperCase()

  // On mount: bring the picker into view inside the dialog's scroll box and
  // move focus to the current swatch. A stable callback ref, so typing in
  // the hex field never re-runs it.
  const mount = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    node.scrollIntoView({ block: 'nearest' })
    const target =
      node.querySelector<HTMLButtonElement>('[data-selected="true"]') ??
      node.querySelector<HTMLButtonElement>('.swatch')
    target?.focus({ preventScroll: true })
  }, [])

  // ESC closes only the picker: the globe's window keydown
  // (app/globe/globeKeys.ts) closes the whole settings dialog on Escape,
  // and it listens in the bubble phase, so stopping here is enough.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  // Invalid input reverts to the stored value.
  const commitHex = () => {
    const hex = parseHexInput(text)
    setDraft(null)
    if (hex) onSelect(hex)
  }

  return (
    <div
      ref={mount}
      id={id}
      className="swatch-picker"
      role="group"
      aria-label={`${label} color picker`}
      onKeyDown={onKeyDown}
    >
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
                onClose()
              }}
            />
          )
        })}
      </div>
      <label className="swatch-hex-row">
        <span className="swatch-hex-label">HEX</span>
        <input
          className="hud-input swatch-hex"
          name={fieldName}
          value={text}
          // Room for a paste with spaces around it: parseHexInput trims, then
          // rejects anything that is not #RRGGBB / RRGGBB.
          maxLength={16}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="done"
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(e) => setDraft({ base: value, text: e.target.value })}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === 'Enter' && commitHex()}
        />
      </label>
    </div>
  )
}
