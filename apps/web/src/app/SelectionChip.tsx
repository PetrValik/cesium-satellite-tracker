import { FollowButton } from '../core/ui/FollowButton'
import { useMode } from '../core/ui/modeStore'
import { useSheet } from '../core/ui/sheetStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import { useTelemetry } from '../features/tracking/telemetryStore'
import { formatKm } from '../lib/format'

interface ChipData {
  kind: string
  name: string
  key: string
  value: string
  deselect: () => void
}

/**
 * The focused mode's selection, condensed for the chip — null when nothing
 * is selected in that mode (the desktop right stack follows the same rule).
 */
function useSelectionSummary(): ChipData | null {
  const mode = useMode((s) => s.mode)
  const satId = useCatalog((s) => s.selectedId)
  const satName = useCatalog((s) => (s.selectedId === null ? undefined : s.byId.get(s.selectedId)?.name))
  const selectSat = useCatalog((s) => s.select)
  const telemetryId = useTelemetry((s) => s.noradId)
  const telemetryName = useTelemetry((s) => s.name)
  const altKm = useTelemetry((s) => s.altKm)
  const mmsi = useShips((s) => s.selectedMmsi)
  const ship = useShips((s) => (s.selectedMmsi === null ? undefined : s.byMmsi.get(s.selectedMmsi)))
  const selectShip = useShips((s) => s.select)
  const icao = useAircraft((s) => s.selectedIcao)
  const aircraft = useAircraft((s) => (s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao)))
  const selectAircraft = useAircraft((s) => s.select)

  if (mode === 'orbital') {
    if (satId === null) return null
    // telemetry trails the selection by one 5 Hz push
    const live = telemetryId === satId
    return {
      kind: 'SAT',
      name: (live ? telemetryName : satName) || `NORAD ${satId}`,
      key: 'ALT',
      value: live ? formatKm(altKm, 0) : '—',
      deselect: () => selectSat(null),
    }
  }
  if (mode === 'maritime') {
    if (mmsi === null) return null
    return {
      kind: 'VSL',
      name: ship?.name || `MMSI ${mmsi}`,
      key: 'SOG',
      value: ship ? `${ship.sogKn.toFixed(1)} KN` : '—',
      deselect: () => selectShip(null),
    }
  }
  if (icao === null) return null
  return {
    kind: 'ACFT',
    name: aircraft?.callsign || icao.toUpperCase(),
    key: 'ALT',
    value: !aircraft
      ? '—'
      : aircraft.onGround
        ? 'GROUND'
        : aircraft.altM === null
          ? '—'
          : `${Math.round(aircraft.altM)} M`,
    deselect: () => selectAircraft(null),
  }
}

/**
 * Compact-HUD selection chip: name + one key value, FOLLOW, DETAILS and
 * deselect, above the dock. DETAILS opens the full selection panels as a
 * sheet directly above the chip (CompactHud), so the chip doubles as that
 * sheet's handle — the panels' own FOLLOW / ✕ are hidden there.
 */
export function SelectionChip() {
  const summary = useSelectionSummary()
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
          aria-controls="hud-sheet-details"
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
        <button className="hud-button chip-deselect" onClick={summary.deselect} aria-label="Deselect">
          ✕
        </button>
      </div>
    </section>
  )
}
