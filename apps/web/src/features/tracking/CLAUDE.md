## Owns
Everything drawn for the ONE selected satellite: the orbit ring, the sliding ground-track window, the live marker, label and footprint, and the telemetry readout store and panel.

## Depends on
`lib/orbital` (`propagateEcef`, `orbitalPeriodMinutes`), `core/engine/icons.satelliteIcon`, `lib/protocol` for `OrbitClass`, and `features/catalog/catalogStore` for the selection — the cross-slice read `docs/ARCHITECTURE.md:33` permits. `app/GlobeView` owns the lifetime, calls `updateLive` each frame and pushes telemetry at ~5 Hz. `features/constellation` hides the selected billboard so this slice can draw it exactly.

## Invariants
- Entities are created once in the constructor and mutated, never recreated per frame; `dispose()` is the destroy path.
- The per-tick hot path (`updateLive`) allocates nothing on our side — it writes into plain fields that `CallbackProperty`/`CallbackPositionProperty` read back, using a module-scope scratch `Cartographic`.
- The orbit ring is stored in ECI kilometres (last sample repeating the first, so it closes) and rotated into ECEF metres by GMST at render time — a rotation about +Z, the same convention as `satellite.js` `eciToEcf`, plus the km→m scale. It is refreshed only when GMST actually moved.
- The ground track is 3D Cartesian points, so the antimeridian needs no special casing; the polyline is `ArcType.NONE` and its geometry is marked `isConstant = false`, or the async geometry batcher thrashes.
- Ground track floats at 10 km and the footprint disk at 5 km: with `globe.depthTestAgainstTerrain` on, a height-0 shape z-fights the globe.
- `footprintRadiusM <= 0` hides the footprint, and the last positive radius is kept so the hidden ellipse never evaluates with degenerate axes.
- `GroundTrackWindow` interior samples sit on a FIXED absolute time grid (`t = k · step`) so the body of the line does not move between frames; only the two exact endpoints are re-propagated. Cost is two SGP4 calls per frame.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- GroundTrackWindow` (vitest; pinned against the same fixed ISS TLE fixture as `lib/orbital.test.ts`, which is what stands between a frame/unit change and a plausible wrong answer) and `-- orbital`. `TrackingVisuals` has no test — a leak or a bad frame there is verified by running it and watching (`CLAUDE.md` → *Verification*). No API, no Docker.
