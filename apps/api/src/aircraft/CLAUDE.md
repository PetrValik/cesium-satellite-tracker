## Owns
The ADS-B slice: the `AdsbFeed` poller against OpenSky `/states/all` (OAuth2 token caching, adaptive cadence, exponential backoff), the positional-array `parseStates`, and the single `GET /api/aircraft` route.

## Depends on
`https://opensky-network.org/api/states/all` and the OpenSky Keycloak token endpoint, optional `clientId`/`clientSecret` (injectable `fetcher`, `now`, `log`), and `Aircraft` from `@orbital-ops/shared`. `index.ts` reads the credentials and starts the feed; `app.ts` mounts the route and composes `status()` into `/api/live/status`. Never imports the `satellites` or `ships` slices.

## Invariants
- Routes are a factory taking the injected feed (`docs/ARCHITECTURE.md:61`).
- The feed is ALWAYS configured: anonymous polling works. Credentials only change the cadence — `ADSB_POLL_AUTH_MS` (60 s) vs `ADSB_POLL_ANON_MS` (600 s). The 503 on `/api/aircraft` means the feed object is absent, not unauthenticated.
- `poll()` never rejects: a failure logs, KEEPS the last snapshot, and resolves false so the loop can back off, doubling to `ADSB_BACKOFF_MAX_MS` (30 min) and resetting to the poll interval on success.
- The OAuth2 token is cached until 60 s before expiry, and a token response with no `access_token` throws rather than being treated as anonymous.
- `parseStates` treats every column as untrusted: state vectors are positional arrays full of nulls, so a row without a usable, in-range position is skipped, and `altM`/`velocityMs`/`trackDeg`/`verticalRateMs` fall back to null rather than 0.
- The timestamp falls back `time_position` → `last_contact` → the poll's own clock, so `tsMs` is never undefined.
- `snapshot()` preserves API order and is capped by `limit`.

## Traps
- `adsb.ts:29` — the column order of `/states/all` is the contract and it is positional only: `0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact, 5 longitude, 6 latitude, …`. Longitude comes BEFORE latitude; there are no field names to catch a swap.
- `adsb.ts:123` — a failed poll must keep the last snapshot. Clearing it would make "OpenSky is down" and "the sky is empty" render identically.

## How to test
`npm test -w apps/api -- adsb` (vitest against an injected fake `fetcher` and clock; `-- app` covers the route and `/api/live/status`). No network, no credentials, no Docker, no running API.
