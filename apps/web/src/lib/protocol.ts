/**
 * Message protocol between the main thread and the propagation worker.
 * Positions are ECEF meters (Cesium's fixed frame); satellite.js works in
 * ECI km internally — conversion happens inside the worker/orbital lib.
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
}

export type WorkerRequest =
  /** Replace the working set; worker builds satrecs and classifies orbits. */
  | { type: 'init'; sats: SatInit[] }
  /** Propagate the whole working set to one sim time. */
  | { type: 'tick'; epochMs: number }
  /** Sample orbit path + ground track for one satellite starting at epochMs. */
  | { type: 'track'; noradId: number; epochMs: number }
  /** Predict passes over an observer within [startMs, startMs + hours]. */
  | {
      type: 'passes'
      requestId: number
      noradId: number
      observer: ObserverGeo
      startMs: number
      hours: number
    }

export type WorkerResponse =
  /** init result; indexes of noradIds/classes match the init order. */
  | { type: 'ready'; count: number; noradIds: number[]; classes: Uint8Array }
  /**
   * Tick result: ECEF meters, layout [x0,y0,z0, x1,y1,z1, ...] in init order.
   * NaN triple = propagation failed (decayed / bad TLE) — skip the point.
   * Transferable; main thread must not retain across ticks.
   */
  | { type: 'positions'; epochMs: number; positions: Float32Array }
  /**
   * Track result: orbitEcef = ECEF meters over one orbital period from
   * epochMs (each sample at its own future time); groundTrack = [lonDeg,
   * latDeg] pairs over the same window.
   */
  | {
      type: 'track'
      noradId: number
      epochMs: number
      periodMinutes: number
      orbitEcef: Float64Array
      groundTrack: Float64Array
    }
  | { type: 'passes'; requestId: number; noradId: number; passes: PassPrediction[] }
  | { type: 'error'; message: string }
