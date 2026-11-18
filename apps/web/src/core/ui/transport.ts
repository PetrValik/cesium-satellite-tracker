import { create } from 'zustand'
import { isSimLive, simClock } from '../sim/simClock'
import { useWallClock } from '../sim/wallClock'
import { useMode } from './modeStore'
import { useSatellites } from './satelliteStore'

/**
 * When the time transport shows: the bar, the status line's SIM readout,
 * the time keys and the app root's `.has-transport` class. The one place
 * that rule is written.
 *
 * Time warp only moves satellites (live feeds suspend under warp), so the
 * transport needs the ORBITAL layer, and it is useful only with a satellite
 * picked. The not-live clause keeps the way back to NOW on screen after a
 * deselect while warped, paused or scrubbed: once sim time is back at NOW
 * with nothing picked, the transport hides.
 */
export function transportVisibleFor(input: {
  satellitesVisible: boolean
  satelliteSelected: boolean
  simLive: boolean
}): boolean {
  return input.satellitesVisible && (input.satelliteSelected || !input.simLive)
}

/**
 * Non-reactive twin for keys and globe wiring. Reads `Date.now()`, so never
 * call it during render (use `useTransportVisible` there).
 */
export function transportVisibleNow(): boolean {
  return transportVisibleFor({
    satellitesVisible: useMode.getState().satellitesVisible,
    satelliteSelected: useSatellites.getState().selectedId !== null,
    simLive: isSimLive(simClock.get()),
  })
}

/**
 * The flag React reads, derived from the four stores the rule depends on and
 * stored only when it flips, so its subscribers hear only a flip. Hooking the
 * inputs directly re-rendered every caller (the App root among them) on each
 * scrub step, rate change and 10 s wall tick.
 *
 * It recomputes on the events that can flip it: the ORBITAL layer, the
 * selection, rate / play-pause / jumpNonce, and the wall tick. Not on
 * epochMs, which moves every frame: at a playing 1x the sim-to-wall offset
 * is constant between events, and the background-tab gap (rAF starved, the
 * epoch left behind) is closed by the wall tick, which frameLoop's
 * needsWallResync fires at once when frames resume. Liveness reads a fresh
 * Date.now() through transportVisibleNow(), never the wall store's nowMs
 * (up to a tick stale), so a NOW reset counts as live at once.
 *
 * Subscribed at module scope on purpose: every input is a module-singleton
 * store, so these subscriptions are made once per page and live exactly as
 * long as the stores, like wallClock's interval; no component owns them and
 * none can leak one. The HMR dispose stops a dev edit of this file from
 * stacking a second set on the surviving stores.
 */
const useVisibility = create<{ visible: boolean }>(() => ({ visible: transportVisibleNow() }))

function recompute(): void {
  const visible = transportVisibleNow()
  if (visible !== useVisibility.getState().visible) useVisibility.setState({ visible })
}

const unsubscribers = [
  useMode.subscribe((s, prev) => {
    if (s.satellitesVisible !== prev.satellitesVisible) recompute()
  }),
  useSatellites.subscribe((s, prev) => {
    if (s.selectedId !== prev.selectedId) recompute()
  }),
  simClock.subscribe((s, prev) => {
    if (s.rate !== prev.rate || s.playing !== prev.playing || s.jumpNonce !== prev.jumpNonce) recompute()
  }),
  useWallClock.subscribe(recompute),
]
import.meta.hot?.dispose(() => {
  for (const unsubscribe of unsubscribers) unsubscribe()
})

/** Non-React access to the derived flag; a subscriber hears each flip, nothing else. */
export const transportVisibility = {
  get: (): boolean => useVisibility.getState().visible,
  subscribe: (listener: (visible: boolean) => void): (() => void) =>
    useVisibility.subscribe((s) => listener(s.visible)),
}

/** React hook: re-renders only when the visibility flips. */
export function useTransportVisible(): boolean {
  return useVisibility((s) => s.visible)
}
