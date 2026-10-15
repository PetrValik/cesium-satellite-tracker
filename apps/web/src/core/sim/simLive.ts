import { useWallClock } from './wallClock'
import { isSimLive, useSimClock } from './simClock'

/**
 * React-side sim liveness for HUD panels ("SUSPENDED — TIME WARP" hints).
 *
 * Recomputes on transport events (rate / play-pause / scrub-NOW jumps) plus
 * the coarse wall tick — never per frame. That is sufficient: playing at 1×
 * the render loop advances the full wall delta, so the sim↔wall offset is
 * constant between events and liveness can only flip on an event. The one
 * gap is a background tab: requestAnimationFrame stops, advance() is starved
 * and the epoch falls behind wall time until frames resume. The 10 s wall
 * tick re-runs the epsilon check against a fresh Date.now(), so liveness
 * follows within one tick.
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
