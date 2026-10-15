/**
 * Selected-satellite readout helpers shared by TelemetryPanel and the
 * compact-HUD chip.
 */
import type { SelectionSummary } from '../../core/ui/selectionSummary'
import { formatKm } from '../../lib/format'
import { useCatalog } from '../catalog/catalogStore'
import { useTelemetry } from './telemetryStore'

/**
 * Inclination from TLE line 2, columns 9–16 (degrees, fixed-width field).
 * Null when the field does not parse to an angle in [0, 180].
 */
export function tleInclinationDeg(tle2: string): number | null {
  const field = tle2.slice(8, 16).trim()
  if (field === '') return null
  const deg = Number(field)
  return Number.isFinite(deg) && deg >= 0 && deg <= 180 ? deg : null
}

/**
 * Chip readout for the selected satellite. `name` and `altKm` come from
 * telemetry once it caught up with the selection, else `altKm` is null and
 * `name` is the catalog's (or missing).
 */
export function satChipSummary(
  noradId: number,
  name: string | undefined,
  altKm: number | null,
): SelectionSummary {
  return {
    kind: 'SAT',
    name: name || `NORAD ${noradId}`,
    key: 'ALT',
    value: altKm === null ? '—' : formatKm(altKm, 0),
  }
}

/** The chip readout for the selected satellite, null when none is selected. */
export function useSatChipSummary(): SelectionSummary | null {
  const satId = useCatalog((s) => s.selectedId)
  const satName = useCatalog((s) => (s.selectedId === null ? undefined : s.byId.get(s.selectedId)?.name))
  const telemetryId = useTelemetry((s) => s.noradId)
  const telemetryName = useTelemetry((s) => s.name)
  const altKm = useTelemetry((s) => s.altKm)
  if (satId === null) return null
  // telemetry trails the selection by one 5 Hz push
  const live = telemetryId === satId
  return satChipSummary(satId, live ? telemetryName : satName, live ? altKm : null)
}
