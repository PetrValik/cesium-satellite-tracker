import { create } from 'zustand'
import type { ObserverGeo, PassPrediction } from '../../lib/protocol'
import { readStored, writeStored } from '../../lib/storage'
import { DEFAULT_OBSERVER, isValidObserver } from './observer'

const STORAGE_KEY = 'orbital-ops.observer'

function parseObserver(value: unknown): ObserverGeo | undefined {
  const o = value as ObserverGeo
  return isValidObserver(o) ? o : undefined
}

export interface PassesState {
  observer: ObserverGeo
  passes: PassPrediction[]
  /** noradId the current passes list was computed for; null = none. */
  computedFor: number | null
  /** Sim time the prediction window was anchored at (ms), null = none. */
  windowStartMs: number | null
  computing: boolean
  selectedPass: number | null
  setObserver: (observer: ObserverGeo) => void
  startCompute: (noradId: number) => void
  setResults: (noradId: number, passes: PassPrediction[], windowStartMs: number) => void
  selectPass: (index: number | null) => void
  clear: () => void
}

export const usePasses = create<PassesState>((set) => ({
  observer: readStored(STORAGE_KEY, parseObserver) ?? DEFAULT_OBSERVER,
  passes: [],
  computedFor: null,
  windowStartMs: null,
  computing: false,
  selectedPass: null,

  setObserver: (observer) => {
    writeStored(STORAGE_KEY, observer)
    set({ observer, computedFor: null, windowStartMs: null, passes: [], selectedPass: null })
  },

  startCompute: (noradId) => set({ computing: true, computedFor: noradId }),

  setResults: (noradId, passes, windowStartMs) =>
    set((s) =>
      s.computedFor === noradId
        ? { passes, windowStartMs, computing: false, selectedPass: null }
        : s,
    ),

  selectPass: (index) => set({ selectedPass: index }),

  clear: () =>
    set({ passes: [], computedFor: null, windowStartMs: null, computing: false, selectedPass: null }),
}))
