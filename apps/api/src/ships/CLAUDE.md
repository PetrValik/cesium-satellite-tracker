## Owns
The AIS slice: the `AisFeed` WebSocket client against aisstream.io (in-memory vessel table, eviction sweep, reconnect backoff, AIS type-code mapping) and the single `GET /api/ships` route.

## Depends on
`wss://stream.aisstream.io/v0/stream` with `AISSTREAM_API_KEY`, the Node ≥22 global `WebSocket` (injectable via `makeSocket`), and `Ship`/`ShipType` from `@orbital-ops/shared`. `index.ts` reads the key and starts the feed; `app.ts` mounts the route and composes `status()` into `/api/live/status`. Never imports the `satellites` or `aircraft` slices.

## Invariants
- Routes are a factory taking the injected feed (`docs/ARCHITECTURE.md:61`), and the feed itself takes injectable `makeSocket`, `now` and `log`.
- No key means unconfigured: `start()` is a no-op and `/api/ships` answers **503**, never an empty 200 — "no vessels" and "no feed" must not look the same.
- Reconnect backoff resets only once a valid DATA frame arrives, never on `open`.
- Handlers never throw; a dead feed degrades to an empty snapshot.
- Every envelope field is verified before use (`num`, `cleanName`); AIS names are '@'-padded fixed-width and the padding is stripped.
- The vessel table is bounded twice: evicted after `AIS_EVICT_AFTER_MS` (15 min) by a periodic sweep, and hard-capped at `AIS_MAX_VESSELS`.
- `snapshot()` is newest-first by `tsMs` and capped by `limit`; `stop()` clears both timers and closes the socket, tolerating a close that throws.
- Timers are `unref()`'d so they never hold the process open.

## Traps
- `ais.ts:92` — aisstream.io accepts the socket BEFORE validating the API key, so resetting the backoff on `open` turns a bad key into a tight reconnect loop.
- `ais.ts:95` — its frames are BINARY: the socket is switched to `arraybuffer` and ArrayBuffer / typed-array / Blob payloads are decoded before JSON parsing. An undecodable frame type is logged once per connection (`loggedUndecodableFrame`) precisely so it cannot be dropped silently.

## How to test
`npm test -w apps/api -- ais` (vitest against a fake socket and clock; `-- app` covers the route and `/api/live/status`). No network, no key, no Docker, no running API.
