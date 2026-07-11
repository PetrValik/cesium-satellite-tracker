import { create } from 'zustand'
import { SHIP_TYPES, type Ship, type ShipType } from '@orbital-ops/shared'
import { api, ApiError } from '../../lib/api'

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
  /** null = unknown (no successful status yet). */
  configured: boolean | null
  connected: boolean
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
  connected: false,
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

let timer: ReturnType<typeof setInterval> | undefined
let unconfiguredBackoff = 0

async function poll(): Promise<void> {
  if (unconfiguredBackoff > 0) {
    unconfiguredBackoff--
    return
  }
  try {
    const ships = await api.ships()
    const byMmsi = new Map(ships.map((s) => [s.mmsi, s]))
    const countsByType: Partial<Record<ShipType, number>> = {}
    for (const s of ships) countsByType[s.shipType] = (countsByType[s.shipType] ?? 0) + 1
    useShips.setState({ ships, byMmsi, countsByType, configured: true, connected: true })
  } catch (err) {
    useShips.setState({ configured: false, connected: false })
    // 503 = feed not configured server-side: back off instead of spamming.
    if (err instanceof ApiError && err.status === 503) {
      unconfiguredBackoff = UNCONFIGURED_RECHECK_TICKS
    }
  }
}

/** Start the ships polling loop (idempotent). */
export function startShipsPolling(): void {
  if (timer !== undefined) return
  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
}

export function stopShipsPolling(): void {
  clearInterval(timer)
  timer = undefined
}
