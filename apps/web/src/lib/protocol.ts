/**
 * Message protocol between the main thread and the propagation worker, plus
 * the pass-prediction types `lib/orbital` returns. Positions are ECEF meters
 * (Cesium's fixed frame); satellite.js works in ECI km internally — the
 * conversion happens inside `lib/orbital`, never at a call site.
 */

export const ORBIT_CLASSES = ['LEO', 'MEO', 'GEO', 'HEO'] as const
export type OrbitClass = (typeof ORBIT_CLASSES)[number]

export interface SatInit {
  noradId: number
  tle1: string
  tle2: string
}

export interface ObserverGeo {
  latDeg: number
  lonDeg: number
  heightM: number
}

export interface PassSample {
  tMs: number
  azDeg: number
  elDeg: number
  rangeKm: number
}

export interface PassPrediction {
  noradId: number
  aosMs: number
  losMs: number
  maxElDeg: number
  maxElMs: number
  /** Az/el trajectory for the sky plot, sampled every ~30 s. */
  samples: PassSample[]
  /**
   * Azimuth, degrees (0 = N, clockwise), of the first sample with `elDeg >= 0`;
   * NaN when there is none. A pass already up at the window start "rises"
   * where it is at the window start.
   */
  riseAzDeg: number
  /** Azimuth, degrees (0 = N, clockwise), of the last sample with `elDeg >= 0`; NaN when none. */
  setAzDeg: number
  /**
   * True when, at one or more samples with `elDeg >= 0`, the satellite is
   * sunlit while the observer's Sun is below −6° (civil twilight is over).
   */
  nakedEye: boolean
}

export type WorkerRequest =
  /** Replace the working set; worker builds satrecs and classifies orbits. */
  | { type: 'init'; sats: SatInit[] }
  /** Propagate the whole working set to one sim time. */
  | { type: 'tick'; epochMs: number }

export type WorkerResponse =
  /** init result; indexes of noradIds/classes match the init order. */
  | { type: 'ready'; count: number; noradIds: number[]; classes: Uint8Array }
  /**
   * Tick result: ECEF meters, layout [x0,y0,z0, x1,y1,z1, ...] in init order.
   * NaN triple = propagation failed (decayed / bad TLE) — skip the point.
   * Transferable; main thread must not retain across ticks.
   */
  | { type: 'positions'; epochMs: number; positions: Float32Array }
  /** A request failed (unknown type, or a handler threw); the worker stays alive. */
  | { type: 'error'; message: string }
