# API reference

The `apps/api` service (Hono + `@hono/node-server`, `node:sqlite`) exposes a
small read-only HTTP API under `/api`. It is same-origin with the web app: in
dev, Vite proxies `/api` to `:8787`; in production the same process serves the
built web app. All response shapes are the zod schemas in
`packages/shared/src/index.ts` — the client re-validates every response against
them, so server and client can't silently drift.

Base path: `/api` · default port `8787` (see [Environment reference](#environment-reference)).

## Endpoints

| Method | Path | Params | Success body (zod schema) | Cache-Control |
|---|---|---|---|---|
| GET | `/api/health` | — | `HealthSchema` — `{ ok, satCount, groups }` | none |
| GET | `/api/groups` | — | `GroupListSchema` — array of `GroupInfoSchema` | `public, max-age=60` |
| GET | `/api/satellites` | query `group` (required) | `SatelliteListSchema` — array of `SatelliteSchema` | `public, max-age=300` |
| GET | `/api/satellites/search` | query `q` (required) | `SatelliteListSchema` (≤ 50 rows) | `public, max-age=30` |
| GET | `/api/satellites/:noradId` | path `noradId` (digits) | `SatelliteSchema` (single) | none |
| GET | `/api/ships` | — | `ShipListSchema` — array of `ShipSchema` | `public, max-age=5` |
| GET | `/api/aircraft` | — | `AircraftListSchema` — array of `AircraftSchema` | `public, max-age=10` |
| GET | `/api/live/status` | — | `LiveStatusSchema` | `no-store` |

Error responses are always `ApiErrorSchema` — `{ error: string }`. That
includes any other path under `/api`, which answers `404 { error: "not found" }`
— never the web app's `index.html`, even when the API serves it.

### GET /api/health
Liveness plus catalog size. `satCount` is the total TLE rows in cache;
`groups` is the number of curated groups. Always `200`.

### GET /api/groups
The 12 curated CelesTrak groups with per-group `count`, `updatedAt` (ISO string
of the last successful refresh, or `null` before the first fetch), and `stale`
(true when the group is past its TTL — a background refresh may already be in
flight; seeded groups start stale). Triggers a background refresh of expired
groups but never blocks on it.

### GET /api/satellites?group=&lt;slug&gt;
Full TLE list for one group. The `group` slug must be one of the curated groups
(`stations`, `last-30-days`, `starlink`, `oneweb`, `iridium-next`, `gps-ops`,
`galileo`, `glo-ops`, `beidou`, `weather`, `geo`, `science`). Serves cached data
immediately; past its TTL the group refreshes from CelesTrak in the background.
The request waits on CelesTrak only when the group has no cached rows at all,
so an unreachable CelesTrak still serves cached/seed data.

| Status | Meaning |
|---|---|
| `400` | `?group=` missing |
| `404` | unknown group slug |
| `503` | CelesTrak unreachable **and** no cached data for the group |

The payload can be large (Starlink ≈ 2.4 MB) but only changes on TLE refresh,
hence the 5-minute cache.

### GET /api/satellites/search?q=&lt;text&gt;
Case-insensitive match on name or NORAD id, capped at 50 rows.

| Status | Meaning |
|---|---|
| `400` | `q` shorter than 2 characters |
| `400` | `q` longer than 64 characters (bounds a cheap CPU-DoS via the LIKE pattern) |

### GET /api/satellites/:noradId
Single satellite by NORAD id.

| Status | Meaning |
|---|---|
| `400` | `noradId` is not all digits |
| `404` | no satellite with that id in cache |

### GET /api/ships
Latest AIS position snapshot. Requires the AIS feed to be configured.

| Status | Meaning |
|---|---|
| `503` | AIS feed not configured — set `AISSTREAM_API_KEY` |

### GET /api/aircraft
Latest ADS-B state-vector snapshot from OpenSky.

| Status | Meaning |
|---|---|
| `503` | ADS-B feed unavailable (feed not wired up) |

Aircraft polling works anonymously out of the box; OpenSky credentials only
change the poll cadence (see below), not availability.

### GET /api/live/status
Health of the two live (non-satellite) feeds. Always `no-store`.

| Feed | Fields |
|---|---|
| `ais` | `configured` (key set), `connected` (socket open), `ships` held, `lastMessageMs` (epoch ms of the last parsed data frame; `null` before the first) |
| `adsb` | `configured` (always `true` when wired), `aircraft` held, `lastPollMs` (epoch ms of the last successful poll; `null` before the first) |

aisstream.io accepts the socket before it checks the key, so an AIS feed that
stays `connected: true` with `lastMessageMs: null` is most likely a rejected key.

## Rate limiting

Every `/api/*` route passes through a fixed-window, in-memory, per-IP limiter:
**300 requests per 60 s window** (defaults; state resets on restart). Over the
limit returns:

| Status | Body | Header |
|---|---|---|
| `429` | `{ error: "rate limit exceeded" }` | `Retry-After: <seconds>` |

By default the client IP comes from the socket. Behind a reverse proxy, set
`TRUST_PROXY=1` so the limiter reads the last hop of `X-Forwarded-For` — enable
this **only** behind a proxy you control, or the header is attacker-supplied.

## CORS

No CORS headers are sent unless `ALLOWED_ORIGINS` is set: the API is same-origin
with the web app by default, so cross-origin reads stay blocked. Set
`ALLOWED_ORIGINS` to a comma-separated allowlist to opt in.

## Environment reference

Feature flags and operational settings (read at boot in `apps/api/src/index.ts`).
Copy `apps/api/.env.example` to `.env` for the live-feed keys.

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8787` | HTTP listen port (in dev, point the web proxy at it with `API_PORT` — see DEVELOPMENT.md) |
| `DATA_DIR` | `<api>/data` (repo) / `/data` (container) | SQLite cache directory (`tle-cache.db`) |
| `WEB_DIST` | unset | absolute path of the built web app to serve; unset = API only |
| `ALLOWED_ORIGINS` | unset | comma-separated CORS allowlist; unset = same-origin only |
| `TRUST_PROXY` | `0` | `1` = read client IP from `X-Forwarded-For` for rate limiting (proxy only) |
| `AISSTREAM_API_KEY` | unset | enables the ships (AIS) feed; unset → `/api/ships` returns `503` |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | unset | authenticated OpenSky polling every 60 s; unset → anonymous polling every 600 s |

The satellite catalog runs offline out of the box from the committed seed and
refreshes itself from CelesTrak (stale-while-revalidate, 6 h TTL, per-group
failure cooldown) — no keys required.
