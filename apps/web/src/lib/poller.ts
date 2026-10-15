/**
 * Fixed-interval polling loop for the live feeds (ships, aircraft): one
 * fetch on start, then one per interval. A failed fetch may ask for a
 * back-off — that many following ticks are skipped — so an unconfigured
 * feed is re-checked occasionally instead of every tick.
 */
export interface PollerOptions<T> {
  intervalMs: number
  fetch: () => Promise<T>
  onData: (data: T) => void
  /** Handle a failed fetch; returns how many following ticks to skip (0 = none). */
  onError: (err: unknown) => number
}

export interface Poller {
  /** Start polling; a no-op while already running. */
  start: () => void
  /** Clear the interval. A fetch already in flight still delivers its result. */
  stop: () => void
}

export function createPoller<T>({ intervalMs, fetch, onData, onError }: PollerOptions<T>): Poller {
  let timer: ReturnType<typeof setInterval> | undefined
  let skipTicks = 0

  const tick = async (): Promise<void> => {
    if (skipTicks > 0) {
      skipTicks--
      return
    }
    let data: T
    try {
      data = await fetch()
    } catch (err) {
      skipTicks = Math.max(0, onError(err))
      return
    }
    onData(data)
  }

  return {
    start: () => {
      if (timer !== undefined) return
      void tick()
      timer = setInterval(() => void tick(), intervalMs)
    },
    stop: () => {
      clearInterval(timer)
      timer = undefined
    },
  }
}
