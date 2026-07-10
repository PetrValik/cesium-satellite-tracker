import { create } from 'zustand'

/** Warp multipliers offered by the transport bar (-60 = rewind). */
export const SIM_RATES = [-60, 1, 10, 60, 600, 3600] as const

export interface SimClockState {
  /** Simulation time, ms since Unix epoch. The single source of truth. */
  epochMs: number
  rate: number
  playing: boolean
  /**
   * Bumped on every discontinuous jump (scrub, NOW). Consumers that need to
   * react to jumps watch this — epoch deltas can't distinguish a jump from
   * one high-warp frame.
   */
  jumpNonce: number
  /** Advance by one animation frame's wall-clock delta. */
  advance: (wallDtMs: number) => void
  setRate: (rate: number) => void
  togglePlay: () => void
  play: () => void
  scrubTo: (epochMs: number) => void
  resetToNow: () => void
}

export const useSimClock = create<SimClockState>((set) => ({
  epochMs: Date.now(),
  rate: 1,
  playing: true,
  jumpNonce: 0,
  advance: (wallDtMs) =>
    set((s) => (s.playing ? { epochMs: s.epochMs + wallDtMs * s.rate } : s)),
  setRate: (rate) => set({ rate }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  play: () => set({ playing: true }),
  scrubTo: (epochMs) => set((s) => ({ epochMs, playing: false, jumpNonce: s.jumpNonce + 1 })),
  resetToNow: () =>
    set((s) => ({ epochMs: Date.now(), rate: 1, playing: true, jumpNonce: s.jumpNonce + 1 })),
}))

/** Non-React read access (worker ticks, Cesium clock sync). */
export const simClock = {
  get: useSimClock.getState,
  subscribe: useSimClock.subscribe,
}
