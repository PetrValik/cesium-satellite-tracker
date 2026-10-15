## Owns
Everything for the ONE selected satellite: its main-thread propagation (`SelectedSatellite` — SGP4 record, orbit-ring sampling window, ground-track window, ~5 Hz telemetry), what is drawn for it (`TrackingVisuals` — orbit ring, sliding ground track, live marker, label and footprint), the pick-ownership tests (`ownsMarker`, `ownsThinDecoration`) `app/globe/tapRouting` asks, the telemetry readout store and panel, and the selection-chip summary (`satSummary`).

## Depends on
`lib/orbital` (`createSatrec`, `classifyOrbit`, `propagateEcef`, `createSatStateEcef`, `SatStateEcef`, `sampleOrbitRingEci`, `rotateEciKmToEcefM`, `footprintRadiusM`, `orbitalPeriodMinutes`), `core/engine/icons.satelliteIcon` and `signalColors`, `lib/protocol` for `OrbitClass`, and `core/ui/satelliteStore` for the selection and the selected satellite's record. `app/globe/createGlobe` owns both classes' lifetime (`TrackingVisuals.dispose`; `SelectedSatellite` holds no Cesium resource); `app/globe/layerSync` calls `select()` on a selection change and `app/globe/frameLoop` calls `frame()` every frame, which feeds `updateLive(state, name)` its reused propagation state. `features/constellation` hides the selected billboard so this slice can draw it exactly.

## Invariants
- Entities are created once in the constructor and mutated, never recreated per frame; `dispose()` is the destroy path.
- The per-tick hot path (`updateLive`) allocates nothing on either side — it reads the caller's reused `SatStateEcef` and writes into plain fields that `CallbackProperty`/`CallbackPositionProperty` read back, using a module-scope scratch `Cartographic`.
- The orbit ring is stored in ECI kilometres (last sample repeating the first, so it closes) and rotated into ECEF metres by GMST at render time through `lib/orbital.rotateEciKmToEcefM` — the same conversion `propagateEcef` uses, so the satellite sits exactly on its ring. It is refreshed only when GMST actually moved.
- The selection draws in signal amber (`core/engine/signalColors`), never its orbit-class palette hue — the same as the ship/aircraft decals; the ground track is cyan.
- The ground track is 3D Cartesian points, so the antimeridian needs no special casing; the polyline is `ArcType.NONE` and its geometry is marked `isConstant = false`, or the async geometry batcher thrashes.
- Ground track floats at 10 km and the footprint disk at 5 km: with `globe.depthTestAgainstTerrain` on, a height-0 shape z-fights the globe.
- `footprintRadiusM <= 0` hides the footprint, and the last positive radius is kept so the hidden ellipse never evaluates with degenerate axes.
- `SelectedSatellite.frame` allocates nothing: one reused `SatStateEcef` for the seed and every frame; the orbit ring is re-sampled (one new `Float64Array`) only once sim time leaves [anchor − 0.1 P, anchor + 0.6 P] (`ringNeedsRefresh`).
- `GroundTrackWindow` interior samples sit on a FIXED absolute time grid (`t = k · step`) so the body of the line does not move between frames; only the two exact endpoints are re-propagated. Cost is two SGP4 calls per frame and no allocation: a fixed `Float64Array` ring buffer, one scratch state, and `update()` returns a view valid until the next call.

## Traps
- `TrackingVisuals.ts:272` — near-miss rule: `ownsThinDecoration` claims ONLY the orbit ring and ground track, so a finger-sized tap landing on those thin lines keeps the selection — in ORBITAL only (`app/globe/tapRouting.ts:97`). Footprint fill, ports and launch sites must stay an empty tap that deselects (`app/selectionMode.ts:95`); adding the footprint here would make a wide disc around the satellite untappable-to-deselect. A tap ON the satellite is `ownsMarker` (`TrackingVisuals.ts:259`).

## How to test
`npm test -w apps/web -- GroundTrackWindow`, `-- SelectedSatellite` (fake visuals: selection, ring staleness, telemetry pacing) and `-- satSummary` (vitest; pinned against the same fixed ISS TLE fixture as `lib/orbital.test.ts`, which is what stands between a frame/unit change and a plausible wrong answer) and `-- orbital`. The near-miss rule is pinned by `npm test -w apps/web -- selectionMode` and `-- tapRouting` (stand-in pick results). `TrackingVisuals` itself still has no test — its Cesium pick-id matching, a leak or a bad frame are verified by running it and watching (`CLAUDE.md` → *Verification*). No API, no Docker.
