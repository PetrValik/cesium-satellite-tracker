/**
 * "The current mode's selection": each domain keeps its own selection in its
 * own store, and the focused mode decides which one FOLLOW, Escape, an empty
 * globe tap, the compact chip and the details sheet act on. SELECTION is the
 * one place that maps a mode to its store's selected field; everything else
 * here (and its callers) goes through it.
 */
import { useSyncExternalStore } from 'react'
import type { StoreApi } from 'zustand'
import { OPS_MODES, useMode, type OpsMode } from '../core/ui/modeStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'

interface DomainSelection {
  /** Whether something is selected. Non-reactive. */
  has: () => boolean
  /** Drop the selection. */
  clear: () => void
  /** Call `listener(selectedNow)` whenever the selected id changes. Returns the unsubscribe. */
  subscribe: (listener: (selected: boolean) => void) => () => void
}

function domainSelection<S>(
  store: StoreApi<S>,
  selectedOf: (s: S) => unknown,
  clear: () => void,
): DomainSelection {
  return {
    has: () => selectedOf(store.getState()) !== null,
    clear,
    subscribe: (listener) =>
      store.subscribe((s, p) => {
        const id = selectedOf(s)
        if (id !== selectedOf(p)) listener(id !== null)
      }),
  }
}

/** Mode → that domain's selection. */
const SELECTION: Record<OpsMode, DomainSelection> = {
  orbital: domainSelection(useCatalog, (s) => s.selectedId, () => useCatalog.getState().select(null)),
  maritime: domainSelection(useShips, (s) => s.selectedMmsi, () => useShips.getState().select(null)),
  airspace: domainSelection(useAircraft, (s) => s.selectedIcao, () => useAircraft.getState().select(null)),
}

/** Whether `mode` (default: the focused mode) has a selected object. Non-reactive. */
export function hasSelectionInMode(mode: OpsMode = useMode.getState().mode): boolean {
  return SELECTION[mode].has()
}

/** Reactive twin of `hasSelectionInMode()` for the focused mode. */
export function useHasSelectionInMode(): boolean {
  const mode = useMode((s) => s.mode)
  const { subscribe, has } = SELECTION[mode]
  return useSyncExternalStore(subscribe, has)
}

/** Drop `mode`'s selection (default: the focused mode); other domains keep theirs. */
export function deselectInMode(mode: OpsMode = useMode.getState().mode): void {
  SELECTION[mode].clear()
}

/**
 * Call `listener(mode, selectedNow)` whenever any domain's selection changes
 * (a pick, a deselect or a switch to another object). Returns the unsubscribe.
 */
export function subscribeSelectionChanges(
  listener: (mode: OpsMode, selected: boolean) => void,
): () => void {
  const offs = OPS_MODES.map((m) => SELECTION[m].subscribe((selected) => listener(m, selected)))
  return () => offs.forEach((off) => off())
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
