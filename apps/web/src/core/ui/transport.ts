import { isSimLive, simClock } from '../sim/simClock'
import { useSimLive } from '../sim/simLive'
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

/** React hook: re-renders on layer, selection and sim-liveness changes. */
export function useTransportVisible(): boolean {
  const satellitesVisible = useMode((s) => s.satellitesVisible)
  const satelliteSelected = useSatellites((s) => s.selectedId !== null)
  const simLive = useSimLive()
  return transportVisibleFor({ satellitesVisible, satelliteSelected, simLive })
}
