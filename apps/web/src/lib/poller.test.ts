import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPoller, type Poller } from './poller'

const INTERVAL_MS = 1_000

let poller: Poller | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  poller?.stop()
  poller = undefined
  vi.useRealTimers()
})

function makePoller(fetch: () => Promise<number>, backoffTicks = 0) {
  const onData = vi.fn()
  const onError = vi.fn(() => backoffTicks)
  const fetchSpy = vi.fn(fetch)
  poller = createPoller({ intervalMs: INTERVAL_MS, fetch: fetchSpy, onData, onError })
  return { poller, fetch: fetchSpy, onData, onError }
}

describe('createPoller', () => {
  it('fetches once on start, then once per interval', async () => {
    const p = makePoller(async () => 42)
    p.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.fetch).toHaveBeenCalledTimes(1)
    expect(p.onData).toHaveBeenCalledWith(42)

    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(4)
    expect(p.onError).not.toHaveBeenCalled()
  })

  it('start is idempotent while running', async () => {
    const p = makePoller(async () => 1)
    p.poller.start()
    p.poller.start()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(2)
  })

  it('stop clears the interval and a later start resumes', async () => {
    const p = makePoller(async () => 1)
    p.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    p.poller.stop()
    await vi.advanceTimersByTimeAsync(5 * INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(1)

    p.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.fetch).toHaveBeenCalledTimes(2)
  })

  it('skips the requested number of ticks after a failure, then re-checks', async () => {
    const err = new Error('feed not configured')
    const p = makePoller(() => Promise.reject(err), 3)
    p.poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(p.onError).toHaveBeenCalledWith(err)
    expect(p.onData).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps polling every tick after a failure that asks for no back-off', async () => {
    const p = makePoller(() => Promise.reject(new Error('unreachable')), 0)
    p.poller.start()
    await vi.advanceTimersByTimeAsync(2 * INTERVAL_MS)
    expect(p.fetch).toHaveBeenCalledTimes(3)
    expect(p.onError).toHaveBeenCalledTimes(3)
  })
})
