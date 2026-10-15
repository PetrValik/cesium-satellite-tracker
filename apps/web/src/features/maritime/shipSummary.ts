/**
 * Vessel readout formatting shared by ShipPanel and the compact-HUD chip,
 * so the two can never disagree on how a vessel is named or its speed shown.
 */
import type { Ship } from '@orbital-ops/shared'
import type { SelectionSummary } from '../../core/ui/selectionSummary'
import { useShips } from './shipsStore'

/** The AIS name; the MMSI while the name is blank or the vessel has aged out of the feed. */
export function vesselName(ship: Ship | undefined, mmsi: number): string {
  return ship?.name || `MMSI ${mmsi}`
}

/** Speed over ground, one decimal, knots. */
export function formatSog(sogKn: number): string {
  return `${sogKn.toFixed(1)} KN`
}

/** Chip readout for the selected vessel (`ship` undefined once it aged out). */
export function shipChipSummary(mmsi: number, ship: Ship | undefined): SelectionSummary {
  return {
    kind: 'VSL',
    name: vesselName(ship, mmsi),
    key: 'SOG',
    value: ship ? formatSog(ship.sogKn) : '—',
  }
}

/** The chip readout for the selected vessel, null when none is selected. */
export function useShipChipSummary(): SelectionSummary | null {
  const mmsi = useShips((s) => s.selectedMmsi)
  const ship = useShips((s) => (s.selectedMmsi === null ? undefined : s.byMmsi.get(s.selectedMmsi)))
  return mmsi === null ? null : shipChipSummary(mmsi, ship)
}
