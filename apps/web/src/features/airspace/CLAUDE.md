## Owns
The ADS-B aircraft slice: the polling store with its altitude bands and heuristic categories, the billboard layer with dead reckoning, the AIR left-rail picture, the selected-aircraft panel and its photo lookup.

## Depends on
`GET /api/aircraft` through `lib/api` (`ApiError`), `Aircraft` from `@orbital-ops/shared`, `core/engine/icons.aircraftIcon`, `core/ui/prefsStore` for the palette. `app/GlobeView` owns the layer's lifetime and calls `advance()`. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `AircraftLayer.dispose()` removes the `BillboardCollection` (`destroyPrimitives` defaults to true).
- Nothing in the per-frame path allocates: module-scope scratch `Cartesian3`s are safe only because Billboard's setters clone (verified against cesium 1.138); the shared `NearFarScalar` and `eyeOffset` are never mutated.
- Dead reckoning stops at `MAX_DEAD_RECKON_MS` (15 min) — a stale state vector is frozen at its 15-minute extrapolation rather than flown off across the globe — and is gated to once per 250 ms.
- `bandOf` in the store and the layer's colour coding use the same boundaries (ground / <3000 m / <9000 m / above); the two must be changed together.
- Band and category filters are ANDed, and toggling either deselects an aircraft that was just filtered away.
- An on-ground aircraft renders flat grey regardless of its category hue.
- A 503 backs the poll off `UNCONFIGURED_RECHECK_TICKS` ticks; a failed poll never clears the last snapshot.

## Traps
- `AircraftLayer.ts:51` — with `scene.globe.depthTestAgainstTerrain` on (`apps/web/src/core/engine/createViewer.ts:121`), taxiing and low-flying aircraft half-sink into terrain and z-fight; the negative-z `eyeOffset` is the fix, and the sign is only right because eye coordinates are left-handed with +z INTO the screen.
- `AircraftLayer.ts:76` — `MIN_COS_LAT` floors the longitude step for the data-error case of an aircraft reported at a pole.
- `aircraftCategory.ts:1` — the ADS-B protocol carries no civil/cargo/military flag, so the category is a heuristic stack (military ICAO-hex blocks + military callsign prefixes + cargo airline prefixes) whose coverage is partial by nature; treat a category as a display hint, never as ground truth.

## How to test
`npm test -w apps/web -- aircraftStore` (vitest). No API, no Docker. `AircraftLayer` has no test — per `CLAUDE.md` → *Verification*, a Cesium leak here shows only after minutes of runtime and is verified by running it and watching.
