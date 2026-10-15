import { describe, expect, it } from 'vitest'
import { createSatrec, propagateEcef } from '../lib/orbital'
import { ORBIT_CLASSES } from '../lib/protocol'
import type { WorkerRequest, WorkerResponse } from '../lib/protocol'
import { createPropagationDispatcher } from './propagationDispatcher'

/** ISS (ZARYA), epoch 2026-07-10 — same fixture as lib/orbital.test.ts. */
const ISS_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  11035-3 0  9998'
const ISS_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339 15.48965714575314'
/** Same elements with B* = 0.99: parses, but SGP4 reports it decayed a day later. */
const DECAYING_TLE1 = '1 25544U 98067A   26191.15356376  .00005628  00000+0  99000-0 0  9998'
/** Mean motion rewritten to ~1.0027 rev/day → classified GEO. */
const GEO_TLE2 = '2 25544  51.6302 186.4276 0006683 277.8890  82.1339  1.00270000575314'
const JD_UNIX_EPOCH = 2440587.5

const ISS_EPOCH_MS = (createSatrec(ISS_TLE1, ISS_TLE2)!.jdsatepoch - JD_UNIX_EPOCH) * 86_400_000

interface Posted {
  msg: WorkerResponse
  transfer: Transferable[]
}

function setup() {
  const posted: Posted[] = []
  const dispatch = createPropagationDispatcher((msg, transfer) => posted.push({ msg, transfer }))
  return { posted, dispatch }
}

/** init with a garbage TLE and a decaying one in the middle of three good ones. */
const INIT: WorkerRequest = {
  type: 'init',
  sats: [
    { noradId: 25544, tle1: ISS_TLE1, tle2: ISS_TLE2 },
    { noradId: 11111, tle1: 'garbage', tle2: 'garbage' },
    { noradId: 22222, tle1: DECAYING_TLE1, tle2: ISS_TLE2 },
    { noradId: 33333, tle1: ISS_TLE1, tle2: GEO_TLE2 },
  ],
}

describe('createPropagationDispatcher', () => {
  it('answers init with ready, echoing the init order and classes', () => {
    const { posted, dispatch } = setup()
    dispatch(INIT)
    expect(posted).toHaveLength(1)
    const { msg, transfer } = posted[0]
    expect(transfer).toEqual([])
    if (msg.type !== 'ready') throw new Error(`expected ready, got ${msg.type}`)
    expect(msg.count).toBe(4)
    // The unparseable TLE keeps its slot: dropping it would shift every later index.
    expect(msg.noradIds).toEqual([25544, 11111, 22222, 33333])
    expect(Array.from(msg.classes, (c) => ORBIT_CLASSES[c])).toEqual(['LEO', 'LEO', 'LEO', 'GEO'])
  })

  it('answers tick with index-aligned ECEF metres, NaN triples for failed slots, transferred', () => {
    const { posted, dispatch } = setup()
    dispatch(INIT)
    const epochMs = ISS_EPOCH_MS + 2 * 86_400_000 // the decaying satellite is gone by now
    dispatch({ type: 'tick', epochMs })
    expect(posted).toHaveLength(2)
    const { msg, transfer } = posted[1]
    if (msg.type !== 'positions') throw new Error(`expected positions, got ${msg.type}`)
    expect(msg.epochMs).toBe(epochMs)
    expect(msg.positions).toBeInstanceOf(Float32Array)
    expect(msg.positions).toHaveLength(3 * 4)
    expect(transfer).toEqual([msg.positions.buffer])

    const iss = propagateEcef(createSatrec(ISS_TLE1, ISS_TLE2)!, epochMs)!
    const geo = propagateEcef(createSatrec(ISS_TLE1, GEO_TLE2)!, epochMs)!
    const slot = (i: number) => Array.from(msg.positions.subarray(3 * i, 3 * i + 3))
    expect(slot(0)).toEqual(iss.positionEcefM.map(Math.fround))
    expect(slot(1).every(Number.isNaN)).toBe(true) // TLE failed to parse
    expect(slot(2).every(Number.isNaN)).toBe(true) // SGP4 failed (decayed)
    expect(slot(3)).toEqual(geo.positionEcefM.map(Math.fround))
  })

  it('answers tick before any init with an empty positions buffer', () => {
    const { posted, dispatch } = setup()
    dispatch({ type: 'tick', epochMs: ISS_EPOCH_MS })
    const { msg } = posted[0]
    if (msg.type !== 'positions') throw new Error(`expected positions, got ${msg.type}`)
    expect(msg.positions).toHaveLength(0)
  })

  it('replaces the working set on re-init', () => {
    const { posted, dispatch } = setup()
    dispatch(INIT)
    dispatch({ type: 'init', sats: [{ noradId: 25544, tle1: ISS_TLE1, tle2: ISS_TLE2 }] })
    dispatch({ type: 'tick', epochMs: ISS_EPOCH_MS })
    const { msg } = posted[2]
    if (msg.type !== 'positions') throw new Error(`expected positions, got ${msg.type}`)
    expect(msg.positions).toHaveLength(3)
    expect(Array.from(msg.positions).every(Number.isFinite)).toBe(true)
  })

  it('answers an unknown request type with an error, including the retired track/passes jobs', () => {
    const { posted, dispatch } = setup()
    for (const type of ['nope', 'track', 'passes']) {
      dispatch({ type } as unknown as WorkerRequest)
    }
    expect(posted.map((p) => p.msg)).toEqual([
      { type: 'error', message: 'unknown request type: nope' },
      { type: 'error', message: 'unknown request type: track' },
      { type: 'error', message: 'unknown request type: passes' },
    ])
  })

  it('turns a throwing handler into an error response instead of throwing', () => {
    const { posted, dispatch } = setup()
    const malformed = { type: 'init', sats: null } as unknown as WorkerRequest
    expect(() => dispatch(malformed)).not.toThrow()
    expect(posted).toHaveLength(1)
    expect(posted[0].msg.type).toBe('error')
  })
})
