import { create } from 'zustand'

/** Warp multipliers offered by the transport bar (-60 = rewind). */
export const SIM_RATES = [-60, 1, 10, 60, 600, 3600] as const

/**
 * The neighbouring warp rate one step slower (-1) or faster (+1) in
 * SIM_RATES — the walk the , / . keys and the compact stepper share.
 * Undefined at either end of the list, or when `rate` is not one of
 * SIM_RATES (nothing steps from an unknown rate).
 */
export function stepRate(rate: number, direction: 1 | -1): number | undefined {
  const index = SIM_RATES.indexOf(rate as (typeof SIM_RATES)[number])
  if (index < 0) return undefined
  return SIM_RATES[index + direction]
}

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
  /**
   * Advance by one animation frame's wall-clock delta. Called every frame:
   * publishing epochMs through the store each frame is the deliberate
   * exception to the no-per-frame-allocation rule. React readers select
   * coarse slices (whole seconds or minutes, rate, playing), so they
   * re-render only when those change.
   */
  advance: (wallDtMs: number) => void
  setRate: (rate: number) => void
  togglePlay: () => void
  play: () => void
  scrubTo: (epochMs: number) => void
  resetToNow: () => void
}

export const useSimClock = create<SimClockState>((set, get) => ({
  epochMs: Date.now(),
  rate: 1,
  playing: true,
  jumpNonce: 0,
  advance: (wallDtMs) => {
    const s = get()
    if (s.playing) set({ epochMs: s.epochMs + wallDtMs * s.rate })
  },
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

/**
 * Sim time within this margin of wall time still counts as "now". Live
 * feeds (ships/aircraft) dead-reckon on WALL time, so beyond this margin
 * their positions are meaningless against the warped scene and they hide.
 */
export const LIVE_EPSILON_MS = 10_000

/**
 * True when the sim clock is indistinguishable from real time: playing at
 * 1× within LIVE_EPSILON_MS of the wall clock. A paused clock is not live
 * (its epoch freezes while wall time runs on), and neither is a playing 1×
 * clock that sits off wall time — setting ×1 again after a warp or a scrub
 * keeps the offset, so the epoch check is not redundant. advance() itself
 * never clamps; the render loop clamps tab-suspend gaps only while warping.
 */
export function isSimLive(
  state: Pick<SimClockState, 'epochMs' | 'rate' | 'playing'>,
  nowMs: number = Date.now(),
): boolean {
  return state.playing && state.rate === 1 && Math.abs(state.epochMs - nowMs) < LIVE_EPSILON_MS
}
