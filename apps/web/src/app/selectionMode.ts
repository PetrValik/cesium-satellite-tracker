/**
 * "The current mode's selection": one rule shared by GlobeView (keyboard,
 * picking, follow resume) and the compact HUD (chip, dock). Each domain
 * keeps its own selection in its own store; the focused mode decides which
 * one FOLLOW, Escape and an empty globe tap act on.
 */
import { useMode, type OpsMode } from '../core/ui/modeStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'

/** Whether `mode` (default: the focused mode) has a selected object. Non-reactive. */
export function hasSelectionInMode(mode: OpsMode = useMode.getState().mode): boolean {
  if (mode === 'orbital') return useCatalog.getState().selectedId !== null
  if (mode === 'maritime') return useShips.getState().selectedMmsi !== null
  return useAircraft.getState().selectedIcao !== null
}

/** Reactive twin of `hasSelectionInMode()` for the focused mode. */
export function useHasSelectionInMode(): boolean {
  const mode = useMode((s) => s.mode)
  const sat = useCatalog((s) => s.selectedId !== null)
  const ship = useShips((s) => s.selectedMmsi !== null)
  const aircraft = useAircraft((s) => s.selectedIcao !== null)
  return mode === 'orbital' ? sat : mode === 'maritime' ? ship : aircraft
}

/** Drop `mode`'s selection (default: the focused mode); other domains keep theirs. */
export function deselectInMode(mode: OpsMode = useMode.getState().mode): void {
  if (mode === 'orbital') useCatalog.getState().select(null)
  else if (mode === 'maritime') useShips.getState().select(null)
  else useAircraft.getState().select(null)
}

/**
 * What one globe tap means:
 * - `claimed`   — a layer matcher took one of the hits (and selected it);
 * - `near-miss` — nobody claimed, but a hit is a thin decoration of the
 *   selection an empty tap would drop (orbit ring, ground track): keep it,
 *   a finger-sized pick window lands on those lines all the time;
 * - `empty`     — nothing claimed and nothing near: deselect in the mode.
 *   Unclaimed area-like or unrelated hits (footprint fill, ports, launch
 *   sites) are deliberately `empty`, never a near-miss.
 * `claimers` run in priority order and stop at the first that returns true.
 */
export type TapOutcome = 'claimed' | 'near-miss' | 'empty'

export function resolveTap(
  hits: readonly unknown[],
  claimers: readonly ((hits: readonly unknown[]) => boolean)[],
  isNearMiss: (hit: unknown) => boolean,
): TapOutcome {
  if (hits.length === 0) return 'empty'
  if (claimers.some((claim) => claim(hits))) return 'claimed'
  return hits.some(isNearMiss) ? 'near-miss' : 'empty'
}
