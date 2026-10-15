import { create } from 'zustand'
import type { Satellite } from '@orbital-ops/shared'

/**
 * The satellite domain's entity and selection state, shared by every slice
 * that needs "which satellite, and what is it". `catalog` publishes what it
 * loads and what search registers; any slice may read it or change the
 * selection (catalog's search pick, tracking's deselect), and `app/` wires
 * the selection to the globe. Group loading (and the worker's working set)
 * stays in the catalog slice's store.
 */
export interface SatelliteState {
  /** Every satellite seen this session (loaded groups + search hits); never shrinks. */
  byId: Map<number, Satellite>
  selectedId: number | null
  select: (noradId: number | null) => void
  /** Make a satellite selectable even when its group isn't active (search). First registration wins. */
  registerSat: (sat: Satellite) => void
  /**
   * Publish a loaded working set into `byId`: a loaded record replaces an
   * earlier one with the same id, ids it does not carry are kept.
   */
  upsertSats: (sats: readonly Satellite[]) => void
}

export const useSatellites = create<SatelliteState>((set) => ({
  byId: new Map(),
  selectedId: null,

  select: (noradId) => set({ selectedId: noradId }),

  registerSat: (sat) =>
    set((s) => {
      if (s.byId.has(sat.noradId)) return s
      const byId = new Map(s.byId)
      byId.set(sat.noradId, sat)
      return { byId }
    }),

  upsertSats: (sats) =>
    set((s) => {
      const byId = new Map(s.byId)
      for (const sat of sats) byId.set(sat.noradId, sat)
      return { byId }
    }),
}))
