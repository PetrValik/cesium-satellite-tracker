import { create } from 'zustand'
import type { Aircraft } from '@orbital-ops/shared'
import { api } from '../../lib/api'

const POLL_MS = 30_000

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

async function poll(): Promise<void> {
  try {
    const aircraft = await api.aircraft()
    useAircraft.setState({
      aircraft,
      byIcao: new Map(aircraft.map((a) => [a.icao24, a])),
      available: true,
      lastPollMs: Date.now(),
    })
  } catch {
    useAircraft.setState({ available: false })
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
