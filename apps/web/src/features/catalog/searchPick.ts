import type { Satellite } from '@orbital-ops/shared'
import { useMode } from '../../core/ui/modeStore'
import { useSatellites } from '../../core/ui/satelliteStore'

/**
 * A catalog search pick, in a globe tap's order (app/globe/tapRouting.ts):
 * register the hit (selectable even while its group is off), focus ORBITAL,
 * then select. The panel can render stacked under another focused domain,
 * whose selection panels would otherwise hide the pick.
 */
export function pickSearchResult(sat: Satellite): void {
  useSatellites.getState().registerSat(sat)
  useMode.getState().setMode('orbital')
  useSatellites.getState().select(sat.noradId)
}
