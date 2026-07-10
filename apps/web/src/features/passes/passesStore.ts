import { create } from 'zustand'
import type { ObserverGeo, PassPrediction } from '../../lib/protocol'

const STORAGE_KEY = 'orbital-ops.observer'

/** Default observer: Prague (the project's home base). */
const DEFAULT_OBSERVER: ObserverGeo = { latDeg: 50.08, lonDeg: 14.44, heightM: 200 }

function loadObserver(): ObserverGeo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_OBSERVER
    const o = JSON.parse(raw) as ObserverGeo
    if (
      Number.isFinite(o.latDeg) &&
      Math.abs(o.latDeg) <= 90 &&
      Number.isFinite(o.lonDeg) &&
      Math.abs(o.lonDeg) <= 180 &&
      Number.isFinite(o.heightM)
    ) {
      return o
    }
  } catch {
    // corrupted storage — fall through to default
  }
  return DEFAULT_OBSERVER
}

export interface PassesState {
  observer: ObserverGeo
  passes: PassPrediction[]
  /** noradId the current passes list was computed for; null = none. */
  computedFor: number | null
  computing: boolean
  selectedPass: number | null
  setObserver: (observer: ObserverGeo) => void
  startCompute: (noradId: number) => void
  setResults: (noradId: number, passes: PassPrediction[]) => void
  selectPass: (index: number | null) => void
  clear: () => void
}

export const usePasses = create<PassesState>((set) => ({
  observer: loadObserver(),
  passes: [],
  computedFor: null,
  computing: false,
  selectedPass: null,

  setObserver: (observer) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(observer))
    } catch {
      // storage may be unavailable (private mode) — observer still works in-memory
    }
    set({ observer, computedFor: null, passes: [], selectedPass: null })
  },

  startCompute: (noradId) => set({ computing: true, computedFor: noradId }),

  setResults: (noradId, passes) =>
    set((s) => (s.computedFor === noradId ? { passes, computing: false, selectedPass: null } : s)),

  selectPass: (index) => set({ selectedPass: index }),

  clear: () => set({ passes: [], computedFor: null, computing: false, selectedPass: null }),
}))
