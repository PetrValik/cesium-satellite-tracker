## Owns
Whole-catalog rendering: one `BillboardCollection` holding every satellite in the working set, tinted by orbit class, interpolated between worker position snapshots; the per-frame math (horizon cull, slerp/lerp) lives Cesium-free in `snapshotMath`.

## Depends on
`core/engine/icons.satelliteIcon`, `lib/protocol` (`ORBIT_CLASSES`, `OrbitClass`), `lib/orbital` (`Vec3Like` type only), and `core/ui/prefsStore` (`DEFAULT_COLORS.satellites` seeds the styles, `ColorPrefs` types them). Imports no slice. `app/globe/createGlobe` owns the layer's lifetime; `app/globe/layerSync` pushes the user palette through `setPalette()` and drives `setVisible` / `setSelected`; `app/globe/constellationFeed` feeds it the worker's `ready` (`setCatalog`) and `positions` (`updatePositions`) messages; `app/globe/frameLoop` calls `advance()` every frame.

## Invariants
- Every Cesium object created has a destroy path: `dispose()` removes the collection (`PrimitiveCollection.destroyPrimitives` defaults to true).
- Billboard order IS the worker's catalog order — `setCatalog` fixes it from the `ready` message (ids and class bytes), and `updatePositions` takes a flat `[x0,y0,z0, …]` ECEF-metre array indexed by it. Reordering `catalogStore.sats` without re-initing the worker silently mis-colours and mis-places the whole catalog.
- A NaN position triple means "TLE failed to propagate" and must hide the billboard, never render at the origin.
- Class bytes index `ORBIT_CLASSES`; that order is the protocol and is authoritative on both sides of the worker boundary.
- `advance()` runs every frame over thousands of billboards and must not allocate — module-scope scratch only, and slerp degrades to a lerp below `LERP_ANGLE_RAD`, where the sagitta is under ~2 km at LEO radius.
- The selected satellite's billboard is hidden here; `features/tracking` renders it exactly, per frame.

## Traps
- `ConstellationLayer.ts:47` — every billboard must share one fixed atlas id via `setImage(id, …)`. Passing the canvas as `image:` in `add()` mints a fresh GUID per billboard and floods the texture atlas with 12k+ copies (verified in cesium 1.138 `Billboard._computeImageTextureProperties`).
- `ConstellationLayer.ts:60` — the extrapolation parameter is clamped: slightly outside the sample pair is fine while the next worker tick is in flight, far outside swings points wildly.
- `snapshotMath.ts:11` — the horizon-culling occlusion sphere is deliberately *smaller* than Earth, so points near the limb never pop early; anything the margin lets through is still hidden by the depth test.

## How to test
`npm test -w apps/web -- snapshotMath` pins the horizon cull against a sampled segment walk and the interpolation against polar coordinates. The layer itself has no test: its failure modes — a texture-atlas blowup and a per-frame allocation — are invisible to a green suite, so verify by `npm run dev` and watching (`CLAUDE.md` → *Verification*). No API, no Docker.
