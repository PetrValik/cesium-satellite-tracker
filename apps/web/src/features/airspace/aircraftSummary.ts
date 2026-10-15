/**
 * Aircraft readout formatting shared by AircraftPanel and the compact-HUD
 * chip, so the two can never disagree on how an aircraft is named or its
 * altitude shown.
 */
import type { Aircraft } from '@orbital-ops/shared'
import type { SelectionSummary } from '../../core/ui/selectionSummary'
import { useAircraft } from './aircraftStore'

/** The callsign; the ICAO24 address while the callsign is blank or the aircraft has aged out. */
export function aircraftName(aircraft: Aircraft | undefined, icao24: string): string {
  return aircraft?.callsign || icao24.toUpperCase()
}

/** Barometric altitude in whole metres; GROUND on the ground, a dash when unknown. */
export function formatAircraftAlt(aircraft: Pick<Aircraft, 'onGround' | 'altM'>): string {
  if (aircraft.onGround) return 'GROUND'
  return aircraft.altM === null ? '—' : `${Math.round(aircraft.altM)} M`
}

/** Chip readout for the selected aircraft (`aircraft` undefined once it aged out). */
export function aircraftChipSummary(icao24: string, aircraft: Aircraft | undefined): SelectionSummary {
  return {
    kind: 'ACFT',
    name: aircraftName(aircraft, icao24),
    key: 'ALT',
    value: aircraft ? formatAircraftAlt(aircraft) : '—',
  }
}

/** The chip readout for the selected aircraft, null when none is selected. */
export function useAircraftChipSummary(): SelectionSummary | null {
  const icao = useAircraft((s) => s.selectedIcao)
  const aircraft = useAircraft((s) => (s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao)))
  return icao === null ? null : aircraftChipSummary(icao, aircraft)
}
