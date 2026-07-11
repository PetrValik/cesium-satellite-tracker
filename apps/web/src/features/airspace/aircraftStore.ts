import { create } from 'zustand'
import type { Aircraft } from '@orbital-ops/shared'
import { api, ApiError } from '../../lib/api'

const POLL_MS = 30_000
/** While the feed reports "not configured", only re-check occasionally. */
const UNCONFIGURED_RECHECK_TICKS = 10

export interface AircraftState {
  aircraft: Aircraft[]
  byIcao: Map<string, Aircraft>
  selectedIcao: string | null
  /** null = unknown (no successful status yet). */
  available: boolean | null
  lastPollMs: number | null
  select: (icao24: string | null) => void
}

export const useAircraft = create<AircraftState>((set) => ({
  aircraft: [],
  byIcao: new Map(),
  selectedIcao: null,
  available: null,
  lastPollMs: null,
  select: (icao24) => set({ selectedIcao: icao24 }),
}))

let timer: ReturnType<typeof setInterval> | undefined
let unconfiguredBackoff = 0

async function poll(): Promise<void> {
  if (unconfiguredBackoff > 0) {
    unconfiguredBackoff--
    return
  }
  try {
    const aircraft = await api.aircraft()
    useAircraft.setState({
      aircraft,
      byIcao: new Map(aircraft.map((a) => [a.icao24, a])),
      available: true,
      lastPollMs: Date.now(),
    })
  } catch (err) {
    useAircraft.setState({ available: false })
    if (err instanceof ApiError && err.status === 503) {
      unconfiguredBackoff = UNCONFIGURED_RECHECK_TICKS
    }
  }
}

/** Start the aircraft polling loop (idempotent). */
export function startAircraftPolling(): void {
  if (timer !== undefined) return
  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
}

export function stopAircraftPolling(): void {
  clearInterval(timer)
  timer = undefined
}
