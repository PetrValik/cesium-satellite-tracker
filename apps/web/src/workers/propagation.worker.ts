/// <reference lib="webworker" />

/**
 * Propagation worker: thin dispatcher over the pure functions in
 * lib/orbital.ts. Owns the satrec working set; all heavy math stays off the
 * main thread. Tick positions go back as a transferable Float32Array.
 */

import { ORBIT_CLASSES } from '../lib/protocol'
import type { WorkerRequest, WorkerResponse } from '../lib/protocol'
import {
  createSatrec,
  classifyOrbit,
  propagateEcef,
  sampleOrbitTrack,
  predictPasses,
} from '../lib/orbital'
import type { SatRec } from 'satellite.js'

declare const self: DedicatedWorkerGlobalScope

/** Working set, in 'init' order. null = TLE failed to parse. */
let satrecs: (SatRec | null)[] = []
let noradIds: number[] = []
const indexByNoradId = new Map<number, number>()

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer)
}

function handleInit(sats: { noradId: number; tle1: string; tle2: string }[]): void {
  satrecs = new Array<SatRec | null>(sats.length)
  noradIds = new Array<number>(sats.length)
  indexByNoradId.clear()
  const classes = new Uint8Array(sats.length)

  for (let i = 0; i < sats.length; i++) {
    const satrec = createSatrec(sats[i].tle1, sats[i].tle2)
    satrecs[i] = satrec
    noradIds[i] = sats[i].noradId
    indexByNoradId.set(sats[i].noradId, i)
    classes[i] = satrec ? ORBIT_CLASSES.indexOf(classifyOrbit(satrec)) : 0
  }

  post({ type: 'ready', count: sats.length, noradIds, classes })
}

function handleTick(epochMs: number): void {
  const n = satrecs.length
  const positions = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    const satrec = satrecs[i]
    const state = satrec ? propagateEcef(satrec, epochMs) : null
    const o = 3 * i
    if (state) {
      positions[o] = state.positionEcefM[0]
      positions[o + 1] = state.positionEcefM[1]
      positions[o + 2] = state.positionEcefM[2]
    } else {
      positions[o] = Number.NaN
      positions[o + 1] = Number.NaN
      positions[o + 2] = Number.NaN
    }
  }
  post({ type: 'positions', epochMs, positions }, [positions.buffer])
}

function lookupSatrec(noradId: number): SatRec | null {
  const index = indexByNoradId.get(noradId)
  if (index === undefined) return null
  return satrecs[index]
}

function handle(req: WorkerRequest): void {
  switch (req.type) {
    case 'init':
      handleInit(req.sats)
      return
    case 'tick':
      handleTick(req.epochMs)
      return
    case 'track': {
      const satrec = lookupSatrec(req.noradId)
      if (!satrec) {
        post({ type: 'error', message: `track: no usable satrec for noradId ${req.noradId}` })
        return
      }
      const track = sampleOrbitTrack(satrec, req.epochMs)
      post(
        {
          type: 'track',
          noradId: req.noradId,
          epochMs: req.epochMs,
          periodMinutes: track.periodMinutes,
          orbitEcef: track.orbitEcef,
          groundTrack: track.groundTrack,
        },
        [track.orbitEcef.buffer, track.groundTrack.buffer],
      )
      return
    }
    case 'passes': {
      const satrec = lookupSatrec(req.noradId)
      if (!satrec) {
        post({ type: 'error', message: `passes: no usable satrec for noradId ${req.noradId}` })
        return
      }
      const passes = predictPasses(satrec, req.observer, req.startMs, req.hours, req.noradId)
      post({ type: 'passes', requestId: req.requestId, noradId: req.noradId, passes })
      return
    }
    default:
      post({
        type: 'error',
        message: `unknown request type: ${String((req as { type?: unknown }).type)}`,
      })
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    handle(event.data)
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
