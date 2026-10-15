/// <reference lib="webworker" />

/**
 * Propagation worker: the thin shell that binds the pure dispatcher
 * (propagationDispatcher.ts) to the worker global. Whole-catalog SGP4 runs
 * here, off the main thread; tick positions go back as a transferable
 * Float32Array.
 */

import { createPropagationDispatcher } from './propagationDispatcher'
import type { WorkerRequest } from '../lib/protocol'

declare const self: DedicatedWorkerGlobalScope

const dispatch = createPropagationDispatcher((msg, transfer) => self.postMessage(msg, transfer))

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  dispatch(event.data)
}
