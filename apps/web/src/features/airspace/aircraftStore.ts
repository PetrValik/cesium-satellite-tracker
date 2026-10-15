import { create } from 'zustand'
import type { Aircraft } from '@orbital-ops/shared'
import { api, ApiError } from '../../lib/api'
import { AIRCRAFT_CATEGORIES, type AircraftCategory } from '../../lib/aircraftCategories'
import { createPoller } from '../../lib/poller'
import { categoryOf } from './aircraftCategory'

/** Altitude bands used for both icon colors and filtering. */
export const ALT_BANDS = ['ground', 'low', 'mid', 'high'] as const
export type AltBand = (typeof ALT_BANDS)[number]

/** Band boundaries match the AircraftLayer color coding. */
export function bandOf(a: Aircraft): AltBand {
  if (a.onGround || a.altM === null) return 'ground'
  if (a.altM < 3_000) return 'low'
  if (a.altM < 9_000) return 'mid'
  return 'high'
}

const POLL_MS = 30_000
/** While the feed reports "not configured", only re-check occasionally. */
const UNCONFIGURED_RECHECK_TICKS = 10

export interface AircraftState {
  aircraft: Aircraft[]
  byIcao: Map<string, Aircraft>
  selectedIcao: string | null
  /** Altitude bands currently shown on the globe. */
  activeBands: Set<AltBand>
  /** Heuristic categories currently shown on the globe (ANDed with bands). */
  activeCategories: Set<AircraftCategory>
  /** null = unknown (no successful status yet). */
  available: boolean | null
  lastPollMs: number | null
  select: (icao24: string | null) => void
  toggleBand: (band: AltBand) => void
  toggleCategory: (category: AircraftCategory) => void
}

export const useAircraft = create<AircraftState>((set) => ({
  aircraft: [],
  byIcao: new Map(),
  selectedIcao: null,
  activeBands: new Set<AltBand>(ALT_BANDS),
  activeCategories: new Set<AircraftCategory>(AIRCRAFT_CATEGORIES),
  available: null,
  lastPollMs: null,
  select: (icao24) => set({ selectedIcao: icao24 }),
  toggleBand: (band) =>
    set((s) => {
      const activeBands = new Set(s.activeBands)
      if (activeBands.has(band)) activeBands.delete(band)
      else activeBands.add(band)
      const selected = s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao)
      const selectedIcao =
        selected !== undefined && !activeBands.has(bandOf(selected)) ? null : s.selectedIcao
      return { activeBands, selectedIcao }
    }),
  toggleCategory: (category) =>
    set((s) => {
      const activeCategories = new Set(s.activeCategories)
      if (activeCategories.has(category)) activeCategories.delete(category)
      else activeCategories.add(category)
      const selected = s.selectedIcao === null ? undefined : s.byIcao.get(s.selectedIcao)
      const selectedIcao =
        selected !== undefined && !activeCategories.has(categoryOf(selected))
          ? null
          : s.selectedIcao
      return { activeCategories, selectedIcao }
    }),
}))

/**
 * The aircraft the globe shows: band and category filters ANDed. Returns
 * the store's own array (same reference) while every filter is on.
 */
export function visibleAircraft(
  s: Pick<AircraftState, 'aircraft' | 'activeBands' | 'activeCategories'>,
): Aircraft[] {
  const allBands = s.activeBands.size === ALT_BANDS.length
  const allCategories = s.activeCategories.size === AIRCRAFT_CATEGORIES.length
  if (allBands && allCategories) return s.aircraft
  return s.aircraft.filter(
    (a) =>
      (allBands || s.activeBands.has(bandOf(a))) &&
      (allCategories || s.activeCategories.has(categoryOf(a))),
  )
}

const poller = createPoller({
  intervalMs: POLL_MS,
  fetch: () => api.aircraft(),
  onData: (aircraft) =>
    useAircraft.setState({
      aircraft,
      byIcao: new Map(aircraft.map((a) => [a.icao24, a])),
      available: true,
      lastPollMs: Date.now(),
    }),
  onError: (err) => {
    // The last snapshot stays; the panel reports the feed unavailable.
    useAircraft.setState({ available: false })
    // Not an ApiError = the response broke the shared contract: say so.
    if (!(err instanceof ApiError)) console.error('[aircraftStore] poll failed', err)
    // 503 = feed not configured server-side: back off instead of spamming.
    return err instanceof ApiError && err.status === 503 ? UNCONFIGURED_RECHECK_TICKS : 0
  },
})

/** Start the aircraft polling loop (idempotent). */
export const startAircraftPolling = poller.start

/** Stop the aircraft polling loop (App's unmount cleanup). */
export const stopAircraftPolling = poller.stop
