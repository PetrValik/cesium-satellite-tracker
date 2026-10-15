## Owns
The AIS vessel slice: the polling store, the dead-reckoning and bearing rules (`shipMotion`), the billboard layer, the MARITIME left-rail picture, the selected-vessel panel and its silhouette, MMSI→flag-state lookup, and the selection-chip summary (`shipSummary`).

## Depends on
`GET /api/ships` through `lib/api` (`ApiError`), polled by `lib/poller`, `Ship`/`ShipType` from `@orbital-ops/shared`, `core/engine/icons.shipIcon` and `travelAxis`, `core/ui/prefsStore` for the palette (`DEFAULT_COLORS.ships` seeds the layer; `app/globe/layerSync` pushes the user's via `setPalette`) and `core/sim/simLive`. `app/globe/createGlobe` owns the layer's lifetime, `app/globe/frameLoop` calls `advance()`, and `app/globe/follow` poses the selected-vessel decal and follow target with `shipPositionAt` / `shipBearingDeg`. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `ShipsLayer.dispose()` removes the `BillboardCollection`, and `PrimitiveCollection.destroyPrimitives` defaults to true, so `remove()` also destroys it.
- Nothing in the per-frame path allocates: module-scope `scratchPosition`/`scratchAxis` are safe only because Billboard's `position` and `alignedAxis` setters clone (verified against cesium 1.138). Shared `NearFarScalar` and `eyeOffset` instances are never mutated.
- ONE motion rule, `shipMotion`, for layer, decal and follow camera: a ship moves along COG (never heading), not at all below `MOORED_SOG_KN`, re-derived from the *report* each pass (`lat0 + vLat·dt`, never accumulated) and frozen after `SHIP_MAX_DEAD_RECKON_MS` (30 min). The layer advances at most once per 250 ms.
- Bearing (orientation only, `shipBearingDeg`): AIS true heading first (an anchored ship's bow still points somewhere real), then COG but only above `MOORED_SOG_KN`; otherwise the layer uses `alignedAxis = ZERO` and the decal falls back to COG. `rotation` stays 0 everywhere.
- Same MMSI set → in-place update; any add/remove churn → wholesale rebuild, at feed cadence and never per frame.
- Toggling a type off deselects a vessel that was just filtered away.
- Only a 503 means the feed is unconfigured server-side (`configured: false`, backing off `UNCONFIGURED_RECHECK_TICKS` polls); any other failure sets `connected: false` and keeps the last snapshot.

## Traps
- `ShipsLayer.ts:40` — with `scene.globe.depthTestAgainstTerrain` on (set in `apps/web/src/core/engine/createViewer.ts:165`), surface billboards half-sink into the globe and z-fight at grazing angles; the fix is a negative-z `eyeOffset`, because eye coordinates are left-handed with +z INTO the screen.
- `shipMotion.ts:29` — `MIN_COS_LAT` floors the equirectangular longitude step so a (data-error) vessel reported at a pole cannot divide by ~0.
- `MaritimePicture.tsx:32` — vessels dead-reckon on WALL time, so the layer hides while sim time is warped away from NOW; the panel must say so rather than show a misleading count.

## How to test
`npm test -w apps/web -- shipsStore`, `-- shipMotion`, `-- shipSummary` and `-- mmsiFlags` (vitest; `shipsStore.test.ts` fakes timers and re-imports the module per test because it owns an interval and a backoff counter). No API, no Docker. `ShipsLayer` has no test — per `CLAUDE.md` → *Verification*, a leak here is verified by running it and watching.
