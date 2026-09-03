## Owns
Whole-catalog rendering: one `BillboardCollection` holding every satellite in the working set, tinted by orbit class, interpolated between worker position snapshots.

## Depends on
`core/engine/icons.satelliteIcon`, `lib/protocol` (`ORBIT_CLASSES`, `OrbitClass`), `core/ui/prefsStore` for the palette, and `features/catalog/catalogStore` — the one cross-slice read `docs/ARCHITECTURE.md:33` permits. `app/GlobeView` owns the layer's lifetime and feeds it the worker's `positions` messages.

## Invariants
- Every Cesium object created has a destroy path: `dispose()` removes the collection (`PrimitiveCollection.destroyPrimitives` defaults to true).
- Billboard order IS the worker's catalog order — `setPositions` takes a flat `[x0,y0,z0, …]` ECEF-metre array indexed by it, and the class byte comes from the same `ready` message. Reordering `catalogStore.sats` without re-initing the worker silently mis-colours and mis-places the whole catalog.
- A NaN position triple means "TLE failed to propagate" and must hide the billboard, never render at the origin.
- Class bytes index `ORBIT_CLASSES`; that order is the protocol and is authoritative on both sides of the worker boundary.
- `advance()` runs every frame over thousands of billboards and must not allocate — module-scope scratch only, and slerp degrades to a lerp below `LERP_ANGLE_RAD`, where the sagitta is under ~2 km at LEO radius.
- The selected satellite's billboard is hidden here; `features/tracking` renders it exactly, per frame.

## Traps
- `ConstellationLayer.ts:79` — every billboard must share one fixed atlas id via `setImage(id, …)`. Passing the canvas as `image:` in `add()` mints a fresh GUID per billboard and floods the texture atlas with 12k+ copies (verified in cesium 1.138 `Billboard._computeImageTextureProperties`).
- `ConstellationLayer.ts:98` — the extrapolation parameter is clamped: slightly outside the sample pair is fine while the next worker tick is in flight, far outside swings points wildly.
- `ConstellationLayer.ts:54` — the horizon-culling occlusion sphere is deliberately *smaller* than Earth, so points near the limb never pop early; anything the margin lets through is still hidden by the depth test.

## How to test
No test file exists for this slice. `npm test -w apps/web` runs the neighbours it depends on (`catalogStore`, `lib/orbital`); the failure modes here — a texture-atlas blowup and a per-frame allocation — are invisible to a green suite, so verify by `npm run dev` and watching (`CLAUDE.md` → *Verification*). No API, no Docker.
