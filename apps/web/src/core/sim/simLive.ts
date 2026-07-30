import { useWallClock } from '../../lib/wallClock'
import { isSimLive, useSimClock } from './simClock'

/**
 * React-side sim liveness for HUD panels ("SUSPENDED — TIME WARP" hints).
 *
 * Recomputes on transport events (rate / play-pause / scrub-NOW jumps) plus
 * the coarse wall tick — never per frame. That is sufficient: at 1×
 * unscrubbed the sim↔wall delta is constant between events, so liveness can
 * only flip on an event, with one exception — a background-tab suspension
 * starves advance() (its dt clamp drops wall time) and lets a playing 1×
 * clock drift silently. The 10 s wall tick catches that within one tick.
 *
 * Kept out of simClock.ts so plain stores/tests importing the clock don't
 * pull in wallClock's module-scope interval.
 */
export function useSimLive(): boolean {
  const playing = useSimClock((s) => s.playing)
  const rate = useSimClock((s) => s.rate)
  // Results intentionally unused — subscribing is the point: a scrub/NOW
  // jump moves epochMs discontinuously, and the wall tick re-runs the
  // epsilon check below against fresh Date.now().
  useSimClock((s) => s.jumpNonce)
  useWallClock((s) => s.nowMs)
  return isSimLive({ playing, rate, epochMs: useSimClock.getState().epochMs })
}
