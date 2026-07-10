import { afterEach, describe, expect, it, vi } from 'vitest'
import { AircraftListSchema } from '@orbital-ops/shared'
import {
  ADSB_POLL_ANON_MS,
  AdsbFeed,
  OPENSKY_STATES_URL,
  OPENSKY_TOKEN_URL,
  parseStates,
} from '../src/adsb.ts'
import { T0 } from './helpers.ts'

const T_POS = 1_749_999_990
const T_CONTACT = 1_749_999_995

/** Realistic /states/all payload: two good rows plus one with a null latitude. */
function statesPayload() {
  return {
    time: Math.floor(T0 / 1000),
    states: [
      // prettier-ignore
      ['4b1814', 'SWR123  ', 'Switzerland', T_POS, T_CONTACT, 8.5492, 47.4612, 11582.4, false, 245.62, 87.3, 0.32, null, 11902.4, '1000', false, 0, 3],
      // no time_position, null callsign, on ground
      ['a1b2c3', null, 'United States', null, T_CONTACT, -73.7781, 40.6413, null, true, 3.2, 180.0, null, null, null, '7710', false, 0, 1],
      // null latitude — must be skipped
      ['badbad', 'GHOST   ', 'Nowhere', T_POS, T_CONTACT, 2.2, null, 1000.0, false, 100.0, 90.0, 0.0, null, null, null, false, 0, 0],
    ],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseStates', () => {
  it('parses rows, skips null positions, and falls back on last_contact for tsMs', () => {
    const aircraft = AircraftListSchema.parse(parseStates(statesPayload(), T0))
    expect(aircraft).toHaveLength(2)
    expect(aircraft[0]).toEqual({
      icao24: '4b1814',
      callsign: 'SWR123',
      latDeg: 47.4612,
      lonDeg: 8.5492,
      altM: 11582.4,
      velocityMs: 245.62,
      trackDeg: 87.3,
      verticalRateMs: 0.32,
      onGround: false,
      tsMs: T_POS * 1000,
    })
    expect(aircraft[1]).toEqual({
      icao24: 'a1b2c3',
      callsign: '',
      latDeg: 40.6413,
      lonDeg: -73.7781,
      altM: null,
      velocityMs: 3.2,
      trackDeg: 180.0,
      verticalRateMs: null,
      onGround: true,
      tsMs: T_CONTACT * 1000,
    })
  })

  it('tolerates garbage bodies', () => {
    expect(parseStates(null, T0)).toEqual([])
    expect(parseStates('nope', T0)).toEqual([])
    expect(parseStates({ time: 1, states: null }, T0)).toEqual([])
    expect(parseStates({ states: [null, 42, {}] }, T0)).toEqual([])
  })
})

describe('AdsbFeed polling', () => {
  it('polls anonymously without any token traffic', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(statesPayload()),
    )
    const feed = new AdsbFeed({ fetcher: fetcher as typeof fetch, now: () => T0, log: () => {} })

    expect(feed.authenticated).toBe(false)
    expect(feed.pollIntervalMs).toBe(ADSB_POLL_ANON_MS)
    expect(await feed.poll()).toBe(true)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![0]).toBe(OPENSKY_STATES_URL)
    expect(headersOf(fetcher.mock.calls[0]![1]).Authorization).toBeUndefined()
    expect(feed.snapshot()).toHaveLength(2)
    expect(feed.snapshot(1)).toHaveLength(1)
    expect(feed.status()).toEqual({ configured: true, aircraft: 2, lastPollMs: T0 })
  })

  it('fetches an OAuth2 token once and sends it as a Bearer header', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === OPENSKY_TOKEN_URL) return jsonResponse({ access_token: 'tok-123', expires_in: 1800 })
      return jsonResponse(statesPayload())
    })
    const feed = new AdsbFeed({
      clientId: 'my-client',
      clientSecret: 'my-secret',
      fetcher: fetcher as typeof fetch,
      now: () => T0,
      log: () => {},
    })

    expect(feed.authenticated).toBe(true)
    expect(await feed.poll()).toBe(true)

    expect(calls[0]!.url).toBe(OPENSKY_TOKEN_URL)
    expect(calls[0]!.init?.method).toBe('POST')
    expect(String(calls[0]!.init?.body)).toBe(
      'grant_type=client_credentials&client_id=my-client&client_secret=my-secret',
    )
    expect(calls[1]!.url).toBe(OPENSKY_STATES_URL)
    expect(headersOf(calls[1]!.init).Authorization).toBe('Bearer tok-123')

    // second poll inside the token lifetime reuses the cached token
    expect(await feed.poll()).toBe(true)
    expect(calls.filter((c) => c.url === OPENSKY_TOKEN_URL)).toHaveLength(1)
    expect(calls.filter((c) => c.url === OPENSKY_STATES_URL)).toHaveLength(2)
  })

  it('keeps the previous snapshot when a poll fails', async () => {
    let fail = false
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      if (fail) throw new Error('network down')
      return jsonResponse(statesPayload())
    })
    const feed = new AdsbFeed({ fetcher: fetcher as typeof fetch, now: () => T0, log: () => {} })

    expect(await feed.poll()).toBe(true)
    expect(feed.snapshot()).toHaveLength(2)

    fail = true
    expect(await feed.poll()).toBe(false)
    expect(feed.snapshot()).toHaveLength(2) // last good data survives
    expect(feed.status()).toEqual({ configured: true, aircraft: 2, lastPollMs: T0 })
  })

  it('treats a non-2xx response as a failed poll', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({ error: 'rate limited' }, 429),
    )
    const feed = new AdsbFeed({ fetcher: fetcher as typeof fetch, now: () => T0, log: () => {} })
    expect(await feed.poll()).toBe(false)
    expect(feed.status()).toEqual({ configured: true, aircraft: 0, lastPollMs: null })
  })

  it('polls on the anonymous cadence and backs off exponentially after failures', async () => {
    vi.useFakeTimers()
    let fail = false
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      if (fail) throw new Error('boom')
      return jsonResponse(statesPayload())
    })
    const feed = new AdsbFeed({ fetcher: fetcher as typeof fetch, log: () => {} })

    feed.start()
    await vi.advanceTimersByTimeAsync(0) // immediate first poll
    expect(fetcher).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(ADSB_POLL_ANON_MS)
    expect(fetcher).toHaveBeenCalledTimes(2)

    fail = true
    await vi.advanceTimersByTimeAsync(ADSB_POLL_ANON_MS) // third poll fails → backoff 2× interval
    expect(fetcher).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(ADSB_POLL_ANON_MS) // only half the backoff elapsed
    expect(fetcher).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(ADSB_POLL_ANON_MS)
    expect(fetcher).toHaveBeenCalledTimes(4)

    feed.stop()
    await vi.advanceTimersByTimeAsync(10 * ADSB_POLL_ANON_MS)
    expect(fetcher).toHaveBeenCalledTimes(4) // stopped — no more polls
  })
})
