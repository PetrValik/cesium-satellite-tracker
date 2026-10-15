## Owns
The ADS-B aircraft slice: the polling store with its altitude bands and heuristic categories, the dead-reckoning rule (`aircraftMotion`), the billboard layer, the AIR left-rail picture, the selected-aircraft panel and its photo lookup, and the selection-chip summary (`aircraftSummary`).

## Depends on
`GET /api/aircraft` and planespotters.net photos through `lib/api` (`ApiError`, `planePhoto`), polled by `lib/poller`, `Aircraft` from `@orbital-ops/shared`, `core/engine/icons.aircraftIcon` and `travelAxis`, `lib/aircraftCategories` for the category list, `core/ui/prefsStore` for the palette (`DEFAULT_COLORS.aircraft` seeds the layer; GlobeView pushes the user's via `setPalette`). `app/GlobeView` owns the layer's lifetime, calls `advance()`, and poses the selected-aircraft decal and follow target with `aircraftPositionAt`. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `AircraftLayer.dispose()` removes the `BillboardCollection` (`destroyPrimitives` defaults to true).
- Nothing in the per-frame path allocates: module-scope scratch `Cartesian3`s are safe only because Billboard's setters clone (verified against cesium 1.138); the shared `NearFarScalar` and `eyeOffset` are never mutated.
- ONE motion rule, `aircraftMotion`, for layer, decal and follow camera: a null velocity or null track does not move at all (altitude included), and reckoning stops at `AIRCRAFT_MAX_DEAD_RECKON_MS` (15 min) — a stale state vector is frozen at its 15-minute extrapolation rather than flown off across the globe. The layer advances at most once per 250 ms.
- The layer shades by the store's own `bandOf` (ground / <3000 m / <9000 m / above), so the filter and the colour can never disagree.
- Band and category filters are ANDed, and toggling either deselects an aircraft that was just filtered away.
- The `ground` band — on ground, or no reported altitude — renders flat grey regardless of its category hue.
- A 503 backs the poll off `UNCONFIGURED_RECHECK_TICKS` ticks; a failed poll never clears the last snapshot.

## Traps
- `AircraftLayer.ts:58` — with `scene.globe.depthTestAgainstTerrain` on (`apps/web/src/core/engine/createViewer.ts:165`), taxiing and low-flying aircraft half-sink into terrain and z-fight; the negative-z `eyeOffset` is the fix, and the sign is only right because eye coordinates are left-handed with +z INTO the screen.
- `aircraftMotion.ts:22` — `MIN_COS_LAT` floors the longitude step for the data-error case of an aircraft reported at a pole.
- `aircraftCategory.ts:1` — the ADS-B protocol carries no civil/cargo/military flag, so the category is a heuristic stack (military ICAO-hex blocks + military callsign prefixes + cargo airline prefixes) whose coverage is partial by nature; treat a category as a display hint, never as ground truth.

## How to test
`npm test -w apps/web -- aircraftStore`, `-- aircraftMotion`, `-- aircraftCategory`, `-- aircraftSummary` and `-- planePhotos` (vitest). No API, no Docker. `AircraftLayer` has no test — per `CLAUDE.md` → *Verification*, a Cesium leak here shows only after minutes of runtime and is verified by running it and watching.
