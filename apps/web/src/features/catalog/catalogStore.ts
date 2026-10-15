import { create } from 'zustand'
import type { GroupInfo, Satellite } from '@orbital-ops/shared'
import { useSatellites } from '../../core/ui/satelliteStore'
import { api } from '../../lib/api'

/** Per-group satellite cache; survives group toggling without refetches. */
const groupCache = new Map<string, Satellite[]>()

/** Starlink (10k+ objects) is opt-in; everything else loads at boot. */
const DEFAULT_OFF = new Set(['starlink'])

function mergeActive(activeSlugs: string[]): Satellite[] {
  const byId = new Map<number, Satellite>()
  for (const slug of activeSlugs) {
    for (const sat of groupCache.get(slug) ?? []) {
      if (!byId.has(sat.noradId)) byId.set(sat.noradId, sat)
    }
  }
  return [...byId.values()]
}

/**
 * Group loading: which groups exist and are active, and the merged working
 * set the propagation worker runs. Satellite entities and the selection
 * live in `core/ui/satelliteStore`. Every new working set is upserted into
 * its `byId` FIRST and only then set as `sats` here, so each id the worker
 * is about to be fed already resolves in `byId` whenever a subscriber of
 * either store looks.
 */
export interface CatalogState {
  groups: GroupInfo[]
  activeSlugs: string[]
  /** Working set sent to the propagation worker (stable order). */
  sats: Satellite[]
  booting: boolean
  loadingGroups: Set<string>
  offline: boolean
  init: () => Promise<void>
  toggleGroup: (slug: string) => Promise<void>
}

export const useCatalog = create<CatalogState>((set, get) => ({
  groups: [],
  activeSlugs: [],
  sats: [],
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
    const sats = mergeActive(loaded)
    useSatellites.getState().upsertSats(sats) // byId before sats
    set({
      activeSlugs: loaded,
      sats,
      booting: false,
      // /groups answered but every group fetch failed: that is offline too,
      // not an empty sky.
      offline: active.length > 0 && loaded.length === 0,
    })
  },

  toggleGroup: async (slug) => {
    const { activeSlugs } = get()
    if (activeSlugs.includes(slug)) {
      const next = activeSlugs.filter((x) => x !== slug)
      const sats = mergeActive(next)
      useSatellites.getState().upsertSats(sats) // byId before sats
      set({ activeSlugs: next, sats })
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
    const sats = mergeActive(next)
    useSatellites.getState().upsertSats(sats) // byId before sats
    set((s) => {
      const loading = new Set(s.loadingGroups)
      loading.delete(slug)
      return {
        activeSlugs: next,
        sats,
        loadingGroups: loading,
        offline: false,
      }
    })
  },
}))
