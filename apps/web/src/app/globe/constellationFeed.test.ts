import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The catalog store imports lib/api; nothing here fetches.
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { simClock } from '../../core/sim/simClock'
import { useSatellites } from '../../core/ui/satelliteStore'
import { useCatalog } from '../../features/catalog/catalogStore'
import type { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import type { WorkerResponse } from '../../lib/protocol'
import { ConstellationFeed } from './constellationFeed'

const ISS = { noradId: 25_544, tle1: 'tle line 1', tle2: 'tle line 2' }
const constellation = {} as unknown as ConstellationLayer

function fakeWorker(postMessage: (msg: unknown) => void) {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    postMessage: vi.fn(postMessage),
  }
}

let doc: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  doc = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('document', doc)
  useCatalog.setState({ sats: [ISS] } as unknown as Parameters<typeof useCatalog.setState>[0])
  useSatellites.setState({ selectedId: null })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ConstellationFeed', () => {
  it('leaves no listener, timer or subscription behind when the initial catalog send throws', () => {
    const catalogSub = vi.spyOn(useCatalog, 'subscribe')
    const clockSub = vi.spyOn(simClock, 'subscribe')
    const worker = fakeWorker(() => {
      throw new Error('DataCloneError: could not be cloned')
    })

    expect(() => new ConstellationFeed(worker as unknown as Worker, constellation)).toThrow(
      'DataCloneError',
    )
    expect(worker.addEventListener).not.toHaveBeenCalled()
    expect(doc.addEventListener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(catalogSub).not.toHaveBeenCalled()
    expect(clockSub).not.toHaveBeenCalled()
  })

  it('sends the catalog, wires up, and dispose undoes every registration', () => {
    const worker = fakeWorker(() => {})
    const feed = new ConstellationFeed(worker as unknown as Worker, constellation)

    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'init', sats: [ISS] })
    expect(worker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(1)

    feed.dispose()
    expect(worker.removeEventListener).toHaveBeenCalledWith(
      'message',
      worker.addEventListener.mock.calls[0][1],
    )
    expect(doc.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      doc.addEventListener.mock.calls[0][1],
    )
    expect(vi.getTimerCount()).toBe(0)
    // Unsubscribed: a catalog change no longer re-sends.
    useCatalog.setState({ sats: [] } as unknown as Parameters<typeof useCatalog.setState>[0])
    expect(worker.postMessage).toHaveBeenCalledTimes(1)
  })

  it('a worker ready lays out the catalog and re-applies the selection from the satellite store', () => {
    useSatellites.setState({ selectedId: ISS.noradId })
    const worker = fakeWorker(() => {})
    const layer = { setCatalog: vi.fn(), setSelected: vi.fn() }
    const feed = new ConstellationFeed(worker as unknown as Worker, layer as unknown as ConstellationLayer)
    const onMessage = worker.addEventListener.mock.calls[0][1] as (e: MessageEvent<WorkerResponse>) => void

    const classes = new Uint8Array([0])
    onMessage({ data: { type: 'ready', count: 1, noradIds: [ISS.noradId], classes } } as MessageEvent<WorkerResponse>)
    expect(layer.setCatalog).toHaveBeenCalledWith([ISS.noradId], classes)
    expect(layer.setSelected).toHaveBeenCalledWith(ISS.noradId)
    expect(layer.setCatalog.mock.invocationCallOrder[0]).toBeLessThan(layer.setSelected.mock.invocationCallOrder[0])
    feed.dispose()
  })
})
