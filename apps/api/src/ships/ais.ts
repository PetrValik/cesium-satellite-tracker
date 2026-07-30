import type { Ship, ShipType } from '@orbital-ops/shared'

export const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream'

/** Vessels not heard from for this long are dropped by the sweep. */
export const AIS_EVICT_AFTER_MS = 15 * 60 * 1000
export const AIS_SWEEP_INTERVAL_MS = 60 * 1000
/** Hard ceiling on tracked vessels; the oldest reports are evicted when over. */
export const AIS_MAX_VESSELS = 20_000
export const AIS_RECONNECT_MIN_MS = 5 * 1000
export const AIS_RECONNECT_MAX_MS = 60 * 1000

/** The slice of the WebSocket API the feed uses (satisfied by the Node >=22 global). */
export interface AisSocket {
  /** How binary frames are surfaced ('blob' | 'arraybuffer' on the global WebSocket). */
  binaryType?: string
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: { data?: unknown }) => void,
  ): void
  send(data: string): void
  close(): void
}

export interface AisFeedOptions {
  /** aisstream.io API key; when absent the feed is unconfigured and start() is a no-op. */
  apiKey: string | undefined
  makeSocket?: (url: string) => AisSocket
  now?: () => number
  log?: (msg: string) => void
}

/** Map an AIS numeric ship-type code onto the coarse SHIP_TYPES slug. */
export function mapShipType(code: number | undefined): ShipType {
  if (code === undefined) return 'other'
  if (code >= 60 && code <= 69) return 'passenger'
  if (code >= 70 && code <= 79) return 'cargo'
  if (code >= 80 && code <= 89) return 'tanker'
  if (code === 30) return 'fishing'
  // 35 = military ops, 55 = law enforcement. Warships often sail dark
  // (AIS off), so this only catches the ones that choose to broadcast.
  if (code === 35 || code === 55) return 'military'
  if (code >= 40 && code <= 49) return 'highspeed'
  return 'other'
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Shared decoder for binary frames (UTF-8). */
const frameDecoder = new TextDecoder()

/** Blob-like: any object exposing a `.text(): Promise<string>` method. */
function isBlobLike(v: unknown): v is { text: () => Promise<string> } {
  return typeof v === 'object' && v !== null && typeof (v as { text?: unknown }).text === 'function'
}

/** AIS names are '@'-padded fixed-width fields; strip the padding. */
function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/@/g, ' ').trim() : ''
}

/** Loose view of an aisstream.io envelope; every field is verified before use. */
interface AisEnvelope {
  MessageType?: unknown
  MetaData?: {
    MMSI?: unknown
    ShipName?: unknown
    latitude?: unknown
    longitude?: unknown
  } | null
  Message?: {
    PositionReport?: {
      Latitude?: unknown
      Longitude?: unknown
      Sog?: unknown
      Cog?: unknown
    } | null
    ShipStaticData?: {
      Type?: unknown
      Name?: unknown
    } | null
  } | null
}

/**
 * Live vessel positions from the aisstream.io WebSocket feed.
 *
 * Keeps the latest report per MMSI in memory; reconnects with exponential
 * backoff (5 s doubling to 60 s max). The backoff resets only once a valid
 * data frame arrives — aisstream.io accepts the socket BEFORE validating the
 * API key, so resetting on 'open' would turn a bad key into a tight
 * reconnect loop. aisstream.io delivers its frames as BINARY WebSocket
 * messages — the socket is switched to 'arraybuffer' and frames are decoded
 * from ArrayBuffer / typed-array / Blob payloads before JSON parsing; a frame
 * of any other type is logged once per connection instead of being dropped
 * silently. Handlers never throw — a dead feed degrades to an empty snapshot.
 */
export class AisFeed {
  readonly configured: boolean
  private readonly apiKey: string | undefined
  private readonly makeSocket: (url: string) => AisSocket
  private readonly now: () => number
  private readonly log: (msg: string) => void
  private readonly ships = new Map<number, Ship>()
  private socket: AisSocket | undefined
  private connected = false
  private running = false
  private backoffMs = AIS_RECONNECT_MIN_MS
  /** One unrecognized-frame log per connection — enough to expose a bad key. */
  private loggedUnknownFrame = false
  /** One undecodable-frame-type log per connection — a silent-drop canary. */
  private loggedUndecodableFrame = false
  /** Epoch ms of the last successfully parsed data frame; undefined until one arrives. */
  private lastMessageMs: number | undefined
  private sweepTimer: ReturnType<typeof setInterval> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: AisFeedOptions) {
    const key = options.apiKey?.trim()
    this.apiKey = key ? key : undefined
    this.configured = this.apiKey !== undefined
    this.makeSocket = options.makeSocket ?? ((url) => new WebSocket(url))
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? ((msg) => console.error(msg))
  }

  /** Connect and start the eviction sweep. No-op when unconfigured or already running. */
  start(): void {
    if (!this.configured || this.running) return
    this.running = true
    this.connect()
    this.sweepTimer = setInterval(() => this.sweep(), AIS_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
  }

  stop(): void {
    this.running = false
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    const socket = this.socket
    this.socket = undefined
    this.connected = false
    if (socket) {
      try {
        socket.close()
      } catch {
        // closing a never-opened socket may throw; nothing to do
      }
    }
  }

  /** Latest reports, newest first, capped at `limit`. */
  snapshot(limit = 20_000): Ship[] {
    return [...this.ships.values()].sort((a, b) => b.tsMs - a.tsMs).slice(0, limit)
  }

  status(): {
    configured: boolean
    connected: boolean
    ships: number
    lastMessageMs: number | undefined
  } {
    return {
      configured: this.configured,
      connected: this.connected,
      ships: this.ships.size,
      lastMessageMs: this.lastMessageMs,
    }
  }

  private connect(): void {
    if (!this.running || this.apiKey === undefined) return
    let socket: AisSocket
    try {
      socket = this.makeSocket(AIS_STREAM_URL)
    } catch (err) {
      this.log(`[ais] failed to open socket: ${String(err)}`)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    try {
      // aisstream.io sends BINARY frames; undici's default binaryType 'blob'
      // would surface them as Blobs. ArrayBuffer keeps decoding synchronous.
      socket.binaryType = 'arraybuffer'
    } catch {
      // a socket that rejects the property still works via the Blob fallback
    }

    // close and error often both fire for one failure — settle only once.
    let settled = false
    const onDisconnect = () => {
      if (settled) return
      settled = true
      if (this.socket === socket) {
        this.socket = undefined
        if (this.connected) {
          this.connected = false
          this.log('[ais] disconnected from aisstream.io')
        }
        this.scheduleReconnect()
      }
    }

    this.loggedUnknownFrame = false
    this.loggedUndecodableFrame = false

    socket.addEventListener('open', () => {
      if (settled || this.socket !== socket) return
      // NOTE: no backoff reset here — the key is only validated after the
      // subscription message, and a rejected key still opens the socket.
      this.connected = true
      this.log('[ais] connected to aisstream.io')
      try {
        socket.send(
          JSON.stringify({
            APIKey: this.apiKey,
            BoundingBoxes: [
              [
                [-90, -180],
                [90, 180],
              ],
            ],
            FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
          }),
        )
      } catch (err) {
        this.log(`[ais] failed to send subscription: ${String(err)}`)
      }
    })

    socket.addEventListener('message', (event) => {
      try {
        this.handleMessage(event.data)
      } catch {
        // malformed frame — drop it, never throw out of a handler
      }
    })

    socket.addEventListener('close', onDisconnect)
    socket.addEventListener('error', onDisconnect)
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer !== undefined) return
    const delayMs = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, AIS_RECONNECT_MAX_MS)
    this.log(`[ais] reconnecting in ${Math.round(delayMs / 1000)}s`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delayMs)
    this.reconnectTimer.unref?.()
  }

  /** Normalize a frame to text: strings pass through, binary frames are decoded. */
  private handleMessage(raw: unknown): void {
    if (typeof raw === 'string') {
      this.handleText(raw)
      return
    }
    if (raw instanceof ArrayBuffer) {
      this.handleText(frameDecoder.decode(raw))
      return
    }
    if (ArrayBuffer.isView(raw)) {
      // Covers Buffer and every typed array; re-viewed as Uint8Array for decode().
      this.handleText(frameDecoder.decode(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)))
      return
    }
    if (isBlobLike(raw)) {
      // Fallback for sockets that ignore binaryType and surface Blobs anyway.
      raw.text().then(
        (text) => {
          try {
            this.handleText(text)
          } catch {
            // handlers never throw, even asynchronously
          }
        },
        () => {
          // unreadable Blob — drop the frame
        },
      )
      return
    }
    if (!this.loggedUndecodableFrame) {
      this.loggedUndecodableFrame = true
      // Without this log, an unexpected frame type silently empties the feed.
      this.log(`[ais] undecodable frame type (dropped): ${Object.prototype.toString.call(raw)}`)
    }
  }

  private handleText(text: string): void {
    let msg: AisEnvelope | null
    try {
      msg = JSON.parse(text) as AisEnvelope | null
    } catch {
      return
    }
    if (msg?.MessageType === 'PositionReport' || msg?.MessageType === 'ShipStaticData') {
      // A valid data frame proves the subscription was accepted — only now
      // is it safe to treat the connection as healthy.
      this.backoffMs = AIS_RECONNECT_MIN_MS
      this.lastMessageMs = this.now()
      if (msg.MessageType === 'PositionReport') this.handlePositionReport(msg)
      else this.handleShipStaticData(msg)
    } else if (msg !== null && !this.loggedUnknownFrame) {
      this.loggedUnknownFrame = true
      // Most commonly an auth-error frame for a bad/revoked API key.
      this.log(`[ais] unrecognized upstream frame (bad API key?): ${JSON.stringify(msg).slice(0, 200)}`)
    }
  }

  private handlePositionReport(msg: AisEnvelope): void {
    const mmsi = num(msg.MetaData?.MMSI)
    if (mmsi === undefined || mmsi < 0) return
    const report = msg.Message?.PositionReport
    const lat = num(report?.Latitude) ?? num(msg.MetaData?.latitude)
    const lon = num(report?.Longitude) ?? num(msg.MetaData?.longitude)
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return
    const prev = this.ships.get(mmsi)
    this.ships.set(mmsi, {
      mmsi,
      name: prev?.name || cleanName(msg.MetaData?.ShipName),
      latDeg: lat,
      lonDeg: lon,
      sogKn: num(report?.Sog) ?? prev?.sogKn ?? 0,
      cogDeg: num(report?.Cog) ?? prev?.cogDeg ?? 0,
      shipType: prev?.shipType ?? 'other',
      tsMs: this.now(),
    })
    if (!prev) this.evictOverCap()
  }

  private handleShipStaticData(msg: AisEnvelope): void {
    const mmsi = num(msg.MetaData?.MMSI)
    if (mmsi === undefined || mmsi < 0) return
    const staticData = msg.Message?.ShipStaticData
    const name = cleanName(staticData?.Name) || cleanName(msg.MetaData?.ShipName)
    const typeCode = num(staticData?.Type)
    const prev = this.ships.get(mmsi)
    if (prev) {
      this.ships.set(mmsi, {
        ...prev,
        name: name || prev.name,
        shipType: typeCode === undefined ? prev.shipType : mapShipType(typeCode),
        tsMs: this.now(),
      })
      return
    }
    // First sighting via static data: MetaData still carries the position.
    const lat = num(msg.MetaData?.latitude)
    const lon = num(msg.MetaData?.longitude)
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) return
    this.ships.set(mmsi, {
      mmsi,
      name,
      latDeg: lat,
      lonDeg: lon,
      sogKn: 0,
      cogDeg: 0,
      shipType: mapShipType(typeCode),
      tsMs: this.now(),
    })
    this.evictOverCap()
  }

  private sweep(): void {
    const cutoff = this.now() - AIS_EVICT_AFTER_MS
    for (const [mmsi, ship] of this.ships) {
      if (ship.tsMs < cutoff) this.ships.delete(mmsi)
    }
  }

  private evictOverCap(): void {
    while (this.ships.size > AIS_MAX_VESSELS) {
      let oldestMmsi = -1
      let oldestTs = Infinity
      for (const [mmsi, ship] of this.ships) {
        if (ship.tsMs < oldestTs) {
          oldestTs = ship.tsMs
          oldestMmsi = mmsi
        }
      }
      if (oldestMmsi === -1) return
      this.ships.delete(oldestMmsi)
    }
  }
}
