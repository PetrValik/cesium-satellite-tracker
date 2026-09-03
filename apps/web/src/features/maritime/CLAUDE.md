## Owns
The AIS vessel slice: the polling store, the billboard layer with its dead reckoning, the MARITIME left-rail picture, the selected-vessel panel and its silhouette, and MMSI→flag-state lookup.

## Depends on
`GET /api/ships` through `lib/api` (`ApiError`), `Ship`/`ShipType` from `@orbital-ops/shared`, `core/engine/icons.shipIcon`, `core/ui/prefsStore` for the palette and `core/sim/simLive`. `app/GlobeView` owns the layer's lifetime and calls `advance()`. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `ShipsLayer.dispose()` removes the `BillboardCollection`, and `PrimitiveCollection.destroyPrimitives` defaults to true, so `remove()` also destroys it.
- Nothing in the per-frame path allocates: module-scope `scratchPosition`/`scratchAxis` are safe only because Billboard's `position` and `alignedAxis` setters clone (verified against cesium 1.138). Shared `NearFarScalar` and `eyeOffset` instances are never mutated.
- Dead reckoning is re-derived from the *report* each pass (`lat0 + vLat·dt`), never accumulated, and is gated to at most once per 250 ms.
- Bearing priority is fixed: AIS true heading first (an anchored ship's bow still points somewhere real), then COG but only above `MOORED_SOG_KN`; otherwise `alignedAxis = ZERO`. `rotation` stays 0 everywhere.
- Same MMSI set → in-place update; any add/remove churn → wholesale rebuild, at feed cadence and never per frame.
- Toggling a type off deselects a vessel that was just filtered away.
- A 503 means the feed is unconfigured server-side, and the store backs off `UNCONFIGURED_RECHECK_TICKS` polls instead of spamming.

## Traps
- `ShipsLayer.ts:43` — with `scene.globe.depthTestAgainstTerrain` on (set in `apps/web/src/core/engine/createViewer.ts:121`), surface billboards half-sink into the globe and z-fight at grazing angles; the fix is a negative-z `eyeOffset`, because eye coordinates are left-handed with +z INTO the screen.
- `ShipsLayer.ts:70` — `MIN_COS_LAT` floors the equirectangular longitude step so a (data-error) vessel reported at a pole cannot divide by ~0.
- `MaritimePicture.tsx:30` — vessels dead-reckon on WALL time, so the layer hides while sim time is warped away from NOW; the panel must say so rather than show a misleading count.

## How to test
`npm test -w apps/web -- shipsStore` and `-- mmsiFlags` (vitest; `shipsStore.test.ts` fakes timers and re-imports the module per test because it owns an interval and a backoff counter). No API, no Docker. `ShipsLayer` has no test — per `CLAUDE.md` → *Verification*, a leak here is verified by running it and watching.
