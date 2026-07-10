import { create } from 'zustand'
import type { OrbitClass } from '../../lib/protocol'

/** Live readout for the selected satellite, pushed from the render loop at ~5 Hz. */
export interface TelemetryState {
  noradId: number | null
  name: string
  orbitClass: OrbitClass | null
  altKm: number
  velocityKmS: number
  latDeg: number
  lonDeg: number
  periodMinutes: number
  update: (t: Partial<TelemetryState>) => void
  clear: () => void
}

const EMPTY = {
  noradId: null,
  name: '',
  orbitClass: null,
  altKm: 0,
  velocityKmS: 0,
  latDeg: 0,
  lonDeg: 0,
  periodMinutes: 0,
} satisfies Omit<TelemetryState, 'update' | 'clear'>

export const useTelemetry = create<TelemetryState>((set) => ({
  ...EMPTY,
  update: (t) => set(t),
  clear: () => set(EMPTY),
}))
