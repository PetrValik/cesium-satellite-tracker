import { simClock } from '../../core/sim/simClock'
import { useSatellites } from '../../core/ui/satelliteStore'
import { useCatalog } from '../../features/catalog/catalogStore'
import type { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import type { SatInit, WorkerRequest, WorkerResponse } from '../../lib/protocol'

/** How often the tick scheduler checks whether a constellation tick is due. */
const TICK_POLL_MS = 100

/** Wall-clock ms between constellation ticks; tighter under heavy time warp. */
export function tickIntervalMs(rate: number): number {
  return Math.abs(rate) > 60 ? 250 : 1000
}

/**
 * Sim time a tick is requested ahead of display time: one tick interval of
 * sim time while playing, so the interpolation window [prev, curr] usually
 * brackets "now" and the layer interpolates instead of extrapolating.
 */
export function tickLeadMs(rate: number, playing: boolean): number {
  return playing ? tickIntervalMs(rate) * rate : 0
}

/**
 * The bridge between the long-lived propagation worker and one globe's
 * ConstellationLayer: (re)sends the catalog, schedules ticks, and feeds the
 * replies to the layer. The worker outlives every globe — a context-loss
 * rebuild only re-wires its message listener and re-sends the catalog.
 */
export class ConstellationFeed {
  private readonly _worker: Worker
  private readonly _constellation: ConstellationLayer
  private _tickBusy = false
  private _lastTickWall = 0
  private _workerReady = false
  private readonly _unsubs: (() => void)[] = []

  constructor(worker: Worker, constellation: ConstellationLayer) {
    this._worker = worker
    this._constellation = constellation

    // Also the rebuild path: the long-lived worker still holds the working
    // set, but this globe's fresh ConstellationLayer only learns the ids and
    // classes from a `ready`, so re-init it (ready → setCatalog → tick).
    // Sent before anything is registered, so a throw here (a DataCloneError
    // from postMessage) leaves nothing behind — createGlobe's own() never
    // sees a constructor that threw. The `ready` reply is a later task, so
    // the message listener below is always in place to receive it.
    const initialSats = useCatalog.getState().sats
    if (initialSats.length > 0) this._sendCatalog(initialSats)

    // Listeners, the tick timer and the store subscriptions last.
    worker.addEventListener('message', this._onMessage)
    document.addEventListener('visibilitychange', this._onVisibilityChange)
    const tickTimer = setInterval(() => {
      // Hidden tab: nothing is drawn (rAF is paused), so whole-catalog
      // propagation would only drain the battery. _onVisibilityChange resyncs.
      if (document.hidden || !this._workerReady || this._tickBusy) return
      const { rate } = simClock.get()
      if (performance.now() - this._lastTickWall < tickIntervalMs(rate)) return
      this._requestTick()
    }, TICK_POLL_MS)
    this._unsubs.push(
      () => clearInterval(tickTimer),
      useCatalog.subscribe((state, prev) => {
        if (state.sats !== prev.sats) this._sendCatalog(state.sats)
      }),
      // Scrub/NOW jumps: drop the interpolation pair and force a fresh tick.
      simClock.subscribe((state, prev) => {
        if (state.jumpNonce !== prev.jumpNonce) this._resync()
      }),
    )
  }

  dispose(): void {
    for (const unsub of this._unsubs) unsub()
    this._unsubs.length = 0
    document.removeEventListener('visibilitychange', this._onVisibilityChange)
    // The worker itself lives on (its owner terminates it on unmount).
    this._worker.removeEventListener('message', this._onMessage)
  }

  private _post(msg: WorkerRequest): void {
    this._worker.postMessage(msg)
  }

  private _requestTick(): void {
    this._tickBusy = true
    const { epochMs, rate, playing } = simClock.get()
    this._post({ type: 'tick', epochMs: epochMs + tickLeadMs(rate, playing) })
  }

  private _sendCatalog(sats: readonly SatInit[]): void {
    this._workerReady = false
    this._tickBusy = false
    this._post({
      type: 'init',
      sats: sats.map(({ noradId, tle1, tle2 }) => ({ noradId, tle1, tle2 })),
    })
  }

  /** The sample pair is stale: drop it and force a fresh tick. */
  private _resync(): void {
    this._constellation.onTimeJump()
    this._lastTickWall = 0
  }

  // The worker outlives this globe: a reply to the previous globe's request
  // can still arrive here. Harmless — positions before this layer's first
  // `ready` are dropped by its empty billboard set, and setCatalog resets
  // the sample pair; this globe's own `init` ends the race.
  private readonly _onMessage = (e: MessageEvent<WorkerResponse>): void => {
    const msg = e.data
    if (msg.type === 'ready') {
      this._constellation.setCatalog(msg.noradIds, msg.classes)
      this._constellation.setSelected(useSatellites.getState().selectedId)
      this._workerReady = true
      this._requestTick()
    } else if (msg.type === 'positions') {
      this._constellation.updatePositions(msg.positions, msg.epochMs)
      this._tickBusy = false
      this._lastTickWall = performance.now()
    } else if (msg.type === 'error') {
      console.error('[propagation.worker]', msg.message)
      this._tickBusy = false
    }
  }

  // Ticks pause while hidden; skipped ticks leave the sample pair stale —
  // same path as a scrub/NOW jump on return.
  private readonly _onVisibilityChange = (): void => {
    if (!document.hidden) this._resync()
  }
}
