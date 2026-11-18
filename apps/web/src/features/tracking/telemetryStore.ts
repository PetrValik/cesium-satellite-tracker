import { create } from 'zustand'
import type { OrbitClass } from '../../lib/protocol'

/**
 * Readout for the selected satellite. Identity and orbit facts are pushed once
 * per selection (`SelectedSatellite.select`); the live fields (altitude,
 * speed, sub-satellite point, `sunlit`) from the render loop at ~5 Hz.
 */
export interface TelemetryState {
  noradId: number | null
  name: string
  orbitClass: OrbitClass | null
  altKm: number
  velocityKmS: number
  latDeg: number
  lonDeg: number
  periodMinutes: number
  /** Out of the Earth's shadow at the last live push; null until the first push after a select. */
  sunlit: boolean | null
  /** Mean-element perigee / apogee, km above the 6378.135 km equatorial radius (title text, not the span). */
  perigeeKm: number
  apogeeKm: number
  /**
   * Lowest / highest geodetic altitude over one orbit from the instant it
   * was last swept for (the selection, then again after > 12 h of sim drift),
   * km: the same altitude as `altKm`, so the live value lies inside.
   * NaN when SGP4 failed over that whole orbit.
   */
  lowKm: number
  highKm: number
  /** TLE epoch, Unix ms UTC. */
  tleEpochMs: number | null
  /** From the international designator (TLE line 1 cols 10-17); null when that field is blank or garbled. */
  launchYear: number | null
  /** COSPAR form, e.g. '1998-067A'; null with `launchYear`. */
  designator: string | null
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
  sunlit: null,
  perigeeKm: 0,
  apogeeKm: 0,
  lowKm: 0,
  highKm: 0,
  tleEpochMs: null,
  launchYear: null,
  designator: null,
} satisfies Omit<TelemetryState, 'update' | 'clear'>

export const useTelemetry = create<TelemetryState>((set) => ({
  ...EMPTY,
  update: (t) => set(t),
  clear: () => set(EMPTY),
}))
