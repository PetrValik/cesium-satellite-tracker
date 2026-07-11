import type { Aircraft } from '@orbital-ops/shared'

export const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all'
export const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

/** Authenticated clients get far higher OpenSky rate limits, so poll faster. */
export const ADSB_POLL_AUTH_MS = 60 * 1000
export const ADSB_POLL_ANON_MS = 600 * 1000
export const ADSB_BACKOFF_MAX_MS = 30 * 60 * 1000

export interface AdsbFeedOptions {
  clientId?: string
  clientSecret?: string
  fetcher?: typeof fetch
  now?: () => number
  log?: (msg: string) => void
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Parse an OpenSky /states/all body into Aircraft records. Rows without a
 * usable position are skipped; every field is guarded because state vectors
 * are positional arrays full of nulls.
 *
 * Column order (per https://openskynetwork.github.io/opensky-api/rest.html):
 * 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
 * 5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
 * 10 true_track, 11 vertical_rate, ...
 */
export function parseStates(body: unknown, fallbackTsMs: number): Aircraft[] {
  const states = (body as { states?: unknown } | null)?.states
  if (!Array.isArray(states)) return []
  const out: Aircraft[] = []
  for (const row of states) {
    if (!Array.isArray(row)) continue
    const icao24 = typeof row[0] === 'string' ? row[0].trim() : ''
    if (icao24 === '') continue
    const lon = num(row[5])
    const lat = num(row[6])
    if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const timePosition = num(row[3])
    const lastContact = num(row[4])
    const tsMs =
      timePosition !== undefined
        ? timePosition * 1000
        : lastContact !== undefined
          ? lastContact * 1000
          : fallbackTsMs
    out.push({
      icao24,
      callsign: typeof row[1] === 'string' ? row[1].trim() : '',
      latDeg: lat,
      lonDeg: lon,
      altM: num(row[7]) ?? null,
      velocityMs: num(row[9]) ?? null,
      trackDeg: num(row[10]) ?? null,
      verticalRateMs: num(row[11]) ?? null,
      onGround: row[8] === true,
      tsMs,
    })
  }
  return out
}

/**
 * Aircraft state vectors polled from OpenSky /states/all.
 *
 * Always configured: anonymous polling works (600 s cadence); with OAuth2
 * client credentials it authenticates (token cached until shortly before
 * expiry) and polls every 60 s. A failed poll keeps the last snapshot and
 * backs off exponentially up to 30 min.
 */
export class AdsbFeed {
  readonly configured = true
  readonly authenticated: boolean
  readonly pollIntervalMs: number
  private readonly clientId: string | undefined
  private readonly clientSecret: string | undefined
  private readonly fetcher: typeof fetch
  private readonly now: () => number
  private readonly log: (msg: string) => void
  private aircraft: Aircraft[] = []
  private lastPollMs: number | null = null
  private token: string | undefined
  private tokenExpiresAtMs = 0
  private backoffMs: number
  private running = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(options: AdsbFeedOptions) {
    const clientId = options.clientId?.trim()
    const clientSecret = options.clientSecret?.trim()
    this.authenticated = Boolean(clientId && clientSecret)
    this.clientId = this.authenticated ? clientId : undefined
    this.clientSecret = this.authenticated ? clientSecret : undefined
    this.pollIntervalMs = this.authenticated ? ADSB_POLL_AUTH_MS : ADSB_POLL_ANON_MS
    this.backoffMs = this.pollIntervalMs
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? ((msg) => console.error(msg))
  }

  /** Poll immediately, then keep polling on the auth-appropriate cadence. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.tick()
  }

  stop(): void {
    this.running = false
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /**
   * One poll of /states/all. Never rejects: a failure logs, keeps the last
   * snapshot, and resolves false so the loop can back off.
   */
  async poll(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {}
      if (this.authenticated) {
        headers.Authorization = `Bearer ${await this.getToken()}`
      }
      const res = await this.fetcher(OPENSKY_STATES_URL, { headers })
      if (!res.ok) throw new Error(`OpenSky /states/all responded ${res.status}`)
      const body: unknown = await res.json()
      this.aircraft = parseStates(body, this.now())
      this.lastPollMs = this.now()
      return true
    } catch (err) {
      this.log(`[adsb] poll failed (keeping last snapshot): ${String(err)}`)
      return false
    }
  }

  /** Latest state vectors in API order, capped at `limit`. */
  snapshot(limit = 20_000): Aircraft[] {
    return this.aircraft.slice(0, limit)
  }

  status(): { configured: boolean; aircraft: number; lastPollMs: number | null } {
    return { configured: this.configured, aircraft: this.aircraft.length, lastPollMs: this.lastPollMs }
  }

  private async tick(): Promise<void> {
    const ok = await this.poll()
    if (!this.running) return
    if (ok) {
      this.backoffMs = this.pollIntervalMs
      this.schedule(this.pollIntervalMs)
    } else {
      this.backoffMs = Math.min(this.backoffMs * 2, ADSB_BACKOFF_MAX_MS)
      this.schedule(this.backoffMs)
    }
  }

  private schedule(delayMs: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick()
    }, delayMs)
    this.timer.unref?.()
  }

  /** OAuth2 client-credentials token, cached until 60 s before expiry. */
  private async getToken(): Promise<string> {
    if (this.token !== undefined && this.now() < this.tokenExpiresAtMs) return this.token
    if (this.clientId === undefined || this.clientSecret === undefined) {
      throw new Error('OpenSky credentials missing')
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    })
    const res = await this.fetcher(OPENSKY_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`OpenSky token endpoint responded ${res.status}`)
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown } | null
    const token = typeof json?.access_token === 'string' ? json.access_token : undefined
    if (token === undefined) throw new Error('OpenSky token endpoint returned no access_token')
    // Tokens live ~30 min; refresh a minute early.
    const expiresInS = num(json?.expires_in) ?? 30 * 60
    this.token = token
    this.tokenExpiresAtMs = this.now() + Math.max(0, expiresInS - 60) * 1000
    return token
  }
}
