/**
 * The propagation worker's logic, free of the worker global so it can be
 * tested in plain Node: owns the satrec working set and answers each request
 * through `post`. All math lives in lib/orbital — this only dispatches.
 */

import { ORBIT_CLASSES } from '../lib/protocol'
import type { SatInit, WorkerRequest, WorkerResponse } from '../lib/protocol'
import { createSatrec, classifyOrbit, propagateBatchEcefM } from '../lib/orbital'
import type { SatRec } from 'satellite.js'

/** Sends one response; `transfer` lists buffers to move rather than copy. */
export type PostResponse = (msg: WorkerResponse, transfer: Transferable[]) => void

/**
 * Build a request handler bound to `post`. The handler never throws: a
 * failing request (unknown type, or a throwing handler) is answered with an
 * `error` response so the worker never dies quietly.
 */
export function createPropagationDispatcher(post: PostResponse): (req: WorkerRequest) => void {
  /** Working set, in 'init' order. null = TLE failed to parse (slot kept). */
  let satrecs: (SatRec | null)[] = []

  const handleInit = (sats: SatInit[]): void => {
    satrecs = new Array<SatRec | null>(sats.length)
    const noradIds = new Array<number>(sats.length)
    const classes = new Uint8Array(sats.length)
    for (let i = 0; i < sats.length; i++) {
      const satrec = createSatrec(sats[i].tle1, sats[i].tle2)
      satrecs[i] = satrec
      noradIds[i] = sats[i].noradId
      classes[i] = satrec ? ORBIT_CLASSES.indexOf(classifyOrbit(satrec)) : 0
    }
    post({ type: 'ready', count: sats.length, noradIds, classes }, [])
  }

  const handleTick = (epochMs: number): void => {
    // A fresh buffer per tick is unavoidable: it is transferred, so this side
    // loses it the moment it is posted.
    const positions = new Float32Array(3 * satrecs.length)
    propagateBatchEcefM(satrecs, epochMs, positions)
    post({ type: 'positions', epochMs, positions }, [positions.buffer])
  }

  const handle = (req: WorkerRequest): void => {
    switch (req.type) {
      case 'init':
        handleInit(req.sats)
        return
      case 'tick':
        handleTick(req.epochMs)
        return
      default:
        post(
          {
            type: 'error',
            message: `unknown request type: ${String((req as { type?: unknown }).type)}`,
          },
          [],
        )
    }
  }

  return (req) => {
    try {
      handle(req)
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) }, [])
    }
  }
}
