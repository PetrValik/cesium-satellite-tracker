import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShipListSchema, type ShipType } from '@orbital-ops/shared'
import {
  AIS_MAX_VESSELS,
  AIS_STREAM_URL,
  AisFeed,
  mapShipType,
  type AisSocket,
} from '../src/ais.ts'
import { T0 } from './helpers.ts'

type SocketListener = (event: { data?: unknown }) => void

class FakeSocket implements AisSocket {
  readonly url: string
  readonly sent: string[] = []
  closed = false
  private readonly listeners = new Map<string, SocketListener[]>()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: SocketListener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  open(): void {
    this.emit('open')
  }

  message(payload: unknown): void {
    this.emit('message', { data: typeof payload === 'string' ? payload : JSON.stringify(payload) })
  }
}

// null = "no API key" (an explicit `undefined` argument would trigger the default)
function feedEnv(apiKey: string | null = 'test-key') {
  const sockets: FakeSocket[] = []
  let clock = T0
  const feed = new AisFeed({
    apiKey: apiKey ?? undefined,
    makeSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    now: () => clock,
    log: () => {},
  })
  return {
    feed,
    sockets,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

function positionReport(mmsi: number, lat: number, lon: number, name = 'EVER GIVEN') {
  return {
    MessageType: 'PositionReport',
    MetaData: { MMSI: mmsi, ShipName: `${name} `, latitude: lat, longitude: lon, time_utc: '' },
    Message: { PositionReport: { Latitude: lat, Longitude: lon, Sog: 12.3, Cog: 245.1, TrueHeading: 244 } },
  }
}

function shipStaticData(mmsi: number, type: number | undefined, name = 'MSC OSCAR@@@') {
  return {
    MessageType: 'ShipStaticData',
    MetaData: { MMSI: mmsi, ShipName: `${name}`, latitude: 1, longitude: 2, time_utc: '' },
    Message: { ShipStaticData: type === undefined ? { Name: name } : { Type: type, Name: name } },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AisFeed connection', () => {
  it('sends the subscription with the API key on open', () => {
    const { feed, sockets } = feedEnv('secret-key')
    feed.start()
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.url).toBe(AIS_STREAM_URL)

    sockets[0]!.open()
    expect(sockets[0]!.sent).toHaveLength(1)
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({
      APIKey: 'secret-key',
      BoundingBoxes: [
        [
          [-90, -180],
          [90, 180],
        ],
      ],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })
    expect(feed.status()).toEqual({ configured: true, connected: true, ships: 0 })
    feed.stop()
  })

  it('is a no-op without an API key', () => {
    const { feed, sockets } = feedEnv(null)
    feed.start()
    expect(sockets).toHaveLength(0)
    expect(feed.status()).toEqual({ configured: false, connected: false, ships: 0 })
    expect(feed.snapshot()).toEqual([])
    feed.stop()
  })

  it('reconnects after close with exponential backoff, reset on open', () => {
    vi.useFakeTimers()
    const { feed, sockets } = feedEnv()
    feed.start()
    expect(sockets).toHaveLength(1)

    sockets[0]!.emit('close')
    expect(sockets).toHaveLength(1) // waits out the 5 s backoff first
    vi.advanceTimersByTime(5_000)
    expect(sockets).toHaveLength(2)

    sockets[1]!.emit('error')
    vi.advanceTimersByTime(5_000) // backoff doubled to 10 s — not yet
    expect(sockets).toHaveLength(2)
    vi.advanceTimersByTime(5_000)
    expect(sockets).toHaveLength(3)

    sockets[2]!.open() // success resets the backoff
    sockets[2]!.emit('close')
    vi.advanceTimersByTime(5_000)
    expect(sockets).toHaveLength(4)
    feed.stop()
  })

  it('does not throw on malformed JSON or unexpected message shapes', () => {
    const { feed, sockets } = feedEnv()
    feed.start()
    sockets[0]!.open()
    expect(() => {
      sockets[0]!.message('{not json at all')
      sockets[0]!.message('null')
      sockets[0]!.message('"just a string"')
      sockets[0]!.message({ MessageType: 'PositionReport' }) // no MetaData/Message
      sockets[0]!.message({ MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: {} })
    }).not.toThrow()
    expect(feed.snapshot()).toEqual([])
    feed.stop()
  })
})

describe('AisFeed vessel state', () => {
  it('upserts a vessel from PositionReport messages', () => {
    const { feed, sockets, advance } = feedEnv()
    feed.start()
    sockets[0]!.open()

    sockets[0]!.message(positionReport(244_123_456, 51.9, 4.1))
    const first = ShipListSchema.parse(feed.snapshot())
    expect(first).toEqual([
      {
        mmsi: 244_123_456,
        name: 'EVER GIVEN',
        latDeg: 51.9,
        lonDeg: 4.1,
        sogKn: 12.3,
        cogDeg: 245.1,
        shipType: 'other',
        tsMs: T0,
      },
    ])

    advance(30_000)
    sockets[0]!.message(positionReport(244_123_456, 52.0, 4.2))
    const second = feed.snapshot()
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ latDeg: 52.0, lonDeg: 4.2, tsMs: T0 + 30_000 })
    expect(feed.status().ships).toBe(1)
    feed.stop()
  })

  it('enriches name and maps AIS type codes via ShipStaticData', () => {
    const cases: Array<[number | undefined, ShipType]> = [
      [70, 'cargo'],
      [84, 'tanker'],
      [65, 'passenger'],
      [30, 'fishing'],
      [45, 'highspeed'],
      [99, 'other'],
      [undefined, 'other'],
    ]
    const { feed, sockets } = feedEnv()
    feed.start()
    sockets[0]!.open()

    cases.forEach(([type, _expected], i) => {
      const mmsi = 100 + i
      sockets[0]!.message(positionReport(mmsi, 10, 20, ''))
      sockets[0]!.message(shipStaticData(mmsi, type))
    })

    const byMmsi = new Map(feed.snapshot().map((s) => [s.mmsi, s]))
    cases.forEach(([, expected], i) => {
      const ship = byMmsi.get(100 + i)!
      expect(ship.shipType).toBe(expected)
      expect(ship.name).toBe('MSC OSCAR') // '@' padding stripped
    })
    feed.stop()
  })

  it('maps the documented AIS type ranges', () => {
    expect(mapShipType(60)).toBe('passenger')
    expect(mapShipType(69)).toBe('passenger')
    expect(mapShipType(79)).toBe('cargo')
    expect(mapShipType(80)).toBe('tanker')
    expect(mapShipType(30)).toBe('fishing')
    expect(mapShipType(31)).toBe('other')
    expect(mapShipType(40)).toBe('highspeed')
    expect(mapShipType(0)).toBe('other')
    expect(mapShipType(undefined)).toBe('other')
  })

  it('evicts vessels not heard from in 15 minutes on the sweep', () => {
    vi.useFakeTimers()
    const { feed, sockets, advance } = feedEnv()
    feed.start()
    sockets[0]!.open()

    sockets[0]!.message(positionReport(111, 10, 20))
    advance(14 * 60_000)
    sockets[0]!.message(positionReport(222, 11, 21))
    advance(2 * 60_000) // 111 is now 16 min stale, 222 only 2 min

    vi.advanceTimersByTime(60_000) // sweep interval fires
    expect(feed.snapshot().map((s) => s.mmsi)).toEqual([222])
    expect(feed.status().ships).toBe(1)
    feed.stop()
  })

  it('returns snapshots newest-first and honors the limit', () => {
    const { feed, sockets, advance } = feedEnv()
    feed.start()
    sockets[0]!.open()

    sockets[0]!.message(positionReport(1, 10, 20))
    advance(1_000)
    sockets[0]!.message(positionReport(2, 11, 21))
    advance(1_000)
    sockets[0]!.message(positionReport(3, 12, 22))

    expect(feed.snapshot().map((s) => s.mmsi)).toEqual([3, 2, 1])
    expect(feed.snapshot(2).map((s) => s.mmsi)).toEqual([3, 2])
    feed.stop()
  })

  it('caps the tracked fleet by evicting the oldest report', () => {
    const { feed, sockets, advance } = feedEnv()
    feed.start()
    sockets[0]!.open()

    for (let mmsi = 1; mmsi <= AIS_MAX_VESSELS + 1; mmsi++) {
      sockets[0]!.message(positionReport(mmsi, 10, 20, ''))
      advance(1)
    }
    expect(feed.status().ships).toBe(AIS_MAX_VESSELS)
    const mmsis = new Set(feed.snapshot(AIS_MAX_VESSELS).map((s) => s.mmsi))
    expect(mmsis.has(1)).toBe(false) // oldest evicted
    expect(mmsis.has(2)).toBe(true)
    expect(mmsis.has(AIS_MAX_VESSELS + 1)).toBe(true)
    feed.stop()
  })
})
