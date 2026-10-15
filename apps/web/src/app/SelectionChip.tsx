import { FollowButton } from '../core/ui/FollowButton'
import { useMode } from '../core/ui/modeStore'
import { useSheet } from '../core/ui/sheetStore'
import { useAircraftChipSummary } from '../features/airspace/aircraftSummary'
import { useShipChipSummary } from '../features/maritime/shipSummary'
import { useSatChipSummary } from '../features/tracking/satSummary'
import { sheetId } from './compactSheets'
import { deselectInMode } from './selectionMode'

/**
 * Compact-HUD selection chip: name + one key value, FOLLOW, DETAILS and
 * deselect, above the dock. DETAILS opens the full selection panels as a
 * sheet directly above the chip (CompactHud), so the chip doubles as that
 * sheet's handle — the panels' own FOLLOW / ✕ are hidden there. Each slice
 * formats its own readout; the chip only picks the focused mode's (null
 * when nothing is selected there — the desktop right stack follows the
 * same rule).
 */
export function SelectionChip() {
  const mode = useMode((s) => s.mode)
  const summaries = {
    orbital: useSatChipSummary(),
    maritime: useShipChipSummary(),
    airspace: useAircraftChipSummary(),
  }
  const summary = summaries[mode]
  const sheet = useSheet((s) => s.sheet)
  const toggle = useSheet((s) => s.toggle)
  if (summary === null) return null
  const detailsOpen = sheet === 'details'

  return (
    <section className="hud-panel selection-chip" aria-label="Selection">
      <div className="chip-readout">
        <span className="chip-kind">{summary.kind}</span>
        <span className="chip-name">{summary.name}</span>
        <span className="chip-value">
          <span className="chip-key">{summary.key}</span> {summary.value}
        </span>
      </div>
      <div className="chip-actions">
        <FollowButton />
        <button
          className={`hud-button chip-details${detailsOpen ? ' is-active' : ''}`}
          aria-expanded={detailsOpen}
          aria-controls={sheetId('details')}
          onClick={() => toggle('details')}
        >
          {/* Only the chevron flips: the label stays DETAILS in both states so
              the open chip never shows a second HIDE right above the dock's
              HIDE (hide all controls), and the button keeps its width.
              aria-expanded carries the state; the name stays "DETAILS". */}
          <span className="chip-chevron" aria-hidden="true">
            {detailsOpen ? '▾' : '▴'}
          </span>
          DETAILS
        </button>
        <button className="hud-button chip-deselect" onClick={() => deselectInMode(mode)} aria-label="Deselect">
          ✕
        </button>
      </div>
    </section>
  )
}
