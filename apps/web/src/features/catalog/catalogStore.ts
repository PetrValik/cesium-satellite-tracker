import { create } from 'zustand'
import type { GroupInfo, Satellite } from '@orbital-ops/shared'
import { api } from '../../lib/api'

/** Per-group satellite cache; survives group toggling without refetches. */
const groupCache = new Map<string, Satellite[]>()

/** Starlink (10k+ objects) is opt-in; everything else loads at boot. */
const DEFAULT_OFF = new Set(['starlink'])

function mergeActive(activeSlugs: string[]): { sats: Satellite[]; byId: Map<number, Satellite> } {
  const byId = new Map<number, Satellite>()
  for (const slug of activeSlugs) {
    for (const sat of groupCache.get(slug) ?? []) {
      if (!byId.has(sat.noradId)) byId.set(sat.noradId, sat)
    }
  }
  return { sats: [...byId.values()], byId }
}

export interface CatalogState {
  groups: GroupInfo[]
  activeSlugs: string[]
  /** Working set sent to the propagation worker (stable order). */
  sats: Satellite[]
  /** Every satellite seen this session (working set + search hits). */
  byId: Map<number, Satellite>
  selectedId: number | null
  booting: boolean
  loadingGroups: Set<string>
  offline: boolean
  init: () => Promise<void>
  toggleGroup: (slug: string) => Promise<void>
  select: (noradId: number | null) => void
  /** Make a satellite selectable even when its group isn't active (search). */
  registerSat: (sat: Satellite) => void
}

export const useCatalog = create<CatalogState>((set, get) => ({
  groups: [],
  activeSlugs: [],
  sats: [],
  byId: new Map(),
  selectedId: null,
  booting: true,
  loadingGroups: new Set(),
  offline: false,

  init: async () => {
    let groups: GroupInfo[]
    try {
      groups = await api.groups()
    } catch {
      set({ offline: true, booting: false })
      return
    }
    const active = groups.filter((g) => !DEFAULT_OFF.has(g.slug)).map((g) => g.slug)
    set({ groups, offline: false })
    await Promise.allSettled(
      active.map(async (slug) => {
        groupCache.set(slug, await api.satellites(slug))
      }),
    )
    const loaded = active.filter((slug) => groupCache.has(slug))
    const merged = mergeActive(loaded)
    set((s) => ({
      activeSlugs: loaded,
      sats: merged.sats,
      byId: new Map([...s.byId, ...merged.byId]),
      booting: false,
    }))
  },

  toggleGroup: async (slug) => {
    const { activeSlugs } = get()
    if (activeSlugs.includes(slug)) {
      const next = activeSlugs.filter((x) => x !== slug)
      const merged = mergeActive(next)
      set((s) => ({ activeSlugs: next, sats: merged.sats, byId: new Map([...s.byId, ...merged.byId]) }))
      return
    }
    if (!groupCache.has(slug)) {
      set((s) => ({ loadingGroups: new Set(s.loadingGroups).add(slug) }))
      try {
        groupCache.set(slug, await api.satellites(slug))
      } catch {
        set((s) => {
          const loading = new Set(s.loadingGroups)
          loading.delete(slug)
          return { loadingGroups: loading, offline: true }
        })
        return
      }
    }
    const next = [...get().activeSlugs, slug]
    const merged = mergeActive(next)
    set((s) => {
      const loading = new Set(s.loadingGroups)
      loading.delete(slug)
      return {
        activeSlugs: next,
        sats: merged.sats,
        byId: new Map([...s.byId, ...merged.byId]),
        loadingGroups: loading,
        offline: false,
      }
    })
  },

  select: (noradId) => set({ selectedId: noradId }),

  registerSat: (sat) =>
    set((s) => {
      if (s.byId.has(sat.noradId)) return s
      const byId = new Map(s.byId)
      byId.set(sat.noradId, sat)
      return { byId }
    }),
}))
