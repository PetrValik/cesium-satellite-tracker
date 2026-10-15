import { create } from 'zustand'
import { SHIP_TYPES, type Ship, type ShipType } from '@orbital-ops/shared'
import { api, ApiError } from '../../lib/api'
import { createPoller } from '../../lib/poller'

const POLL_MS = 10_000
/** While the feed reports "not configured", only re-check occasionally. */
const UNCONFIGURED_RECHECK_TICKS = 30

export interface ShipsState {
  ships: Ship[]
  byMmsi: Map<number, Ship>
  countsByType: Partial<Record<ShipType, number>>
  selectedMmsi: number | null
  /** Ship types currently shown on the globe (filter rows in the picture panel). */
  activeTypes: Set<ShipType>
  /**
   * Whether the server has an AIS feed: false only on a 503 (no
   * AISSTREAM_API_KEY), true after a successful poll, null until either.
   */
  configured: boolean | null
  /**
   * Whether the last poll succeeded: false after any failure (network,
   * 5xx, 503, contract drift), null before the first poll settles. A failed
   * poll keeps the last snapshot.
   */
  connected: boolean | null
  select: (mmsi: number | null) => void
  toggleType: (type: ShipType) => void
}

export const useShips = create<ShipsState>((set) => ({
  ships: [],
  byMmsi: new Map(),
  countsByType: {},
  selectedMmsi: null,
  activeTypes: new Set<ShipType>(SHIP_TYPES),
  configured: null,
  connected: null,
  select: (mmsi) => set({ selectedMmsi: mmsi }),
  toggleType: (type) =>
    set((s) => {
      const activeTypes = new Set(s.activeTypes)
      if (activeTypes.has(type)) activeTypes.delete(type)
      else activeTypes.add(type)
      // Deselect a vessel that just got filtered away.
      const selected = s.selectedMmsi === null ? undefined : s.byMmsi.get(s.selectedMmsi)
      const selectedMmsi =
        selected !== undefined && !activeTypes.has(selected.shipType) ? null : s.selectedMmsi
      return { activeTypes, selectedMmsi }
    }),
}))

/**
 * The vessels the globe shows: the type filter applied. Returns the store's
 * own array (same reference) while every type is on.
 */
export function visibleShips(s: Pick<ShipsState, 'ships' | 'activeTypes'>): Ship[] {
  return s.activeTypes.size === SHIP_TYPES.length
    ? s.ships
    : s.ships.filter((ship) => s.activeTypes.has(ship.shipType))
}

const poller = createPoller({
  intervalMs: POLL_MS,
  fetch: () => api.ships(),
  onData: (ships) => {
    const byMmsi = new Map(ships.map((s) => [s.mmsi, s]))
    const countsByType: Partial<Record<ShipType, number>> = {}
    for (const s of ships) countsByType[s.shipType] = (countsByType[s.shipType] ?? 0) + 1
    useShips.setState({ ships, byMmsi, countsByType, configured: true, connected: true })
  },
  onError: (err) => {
    // 503 = feed not configured server-side: say so, and back off instead
    // of spamming. Any other failure leaves `configured` as it was.
    if (err instanceof ApiError && err.status === 503) {
      useShips.setState({ configured: false, connected: false })
      return UNCONFIGURED_RECHECK_TICKS
    }
    useShips.setState({ connected: false })
    // Not an ApiError = the response broke the shared contract: say so.
    if (!(err instanceof ApiError)) console.error('[shipsStore] poll failed', err)
    return 0
  },
})

/** Start the ships polling loop (idempotent). */
export const startShipsPolling = poller.start

/** Stop the ships polling loop (App's unmount cleanup). */
export const stopShipsPolling = poller.stop
