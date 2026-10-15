## Owns
The two static ground overlays: orbital launch sites (signal-amber rocket) and major ports (cyan anchor), each a billboard collection plus a label collection built once in its constructor. Neither is pickable: a tap on one is an empty tap.

## Depends on
`core/engine/icons.rocketIcon` / `icons.anchorIcon`, `core/engine/signalColors` for the tints, and the committed datasets `src/data/launchSites.json` and `src/data/ports.json`, whose row shape is mirrored by the exported `LaunchSite` / `Port` interfaces. `app/globe/createGlobe` owns both layers' lifetimes and `app/globe/tapRouting` claims no infra hit; `app/LayersPanel` toggles them through `core/ui/modeStore`, which `app/globe/layerSync` applies via `setVisible`. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `dispose()` removes both collections, and `PrimitiveCollection.destroyPrimitives` defaults to true, so `remove()` destroys them.
- Nothing runs per frame here — the layer is static, so the shared scratch `Cartesian3` is constructor-only and the sites are never rebuilt.
- One fixed atlas image id per layer, so all sites share a single texture-atlas entry.
- Billboards and labels keep the default `disableDepthTestDistance`, so they hide behind the globe; labels additionally carry `DistanceDisplayCondition(0, 12_000_000)` so names disappear at globe range instead of piling up.
- Icons carry no rotation — an upright rocket or anchor reads at any camera heading.
- The two files are deliberate near-duplicates; a change to one is almost always a change to both.

## Traps
- `LaunchSitesLayer.ts:50` (and `PortsLayer.ts:50`) — with `scene.globe.depthTestAgainstTerrain` on (`apps/web/src/core/engine/createViewer.ts:165`), surface-level billboards half-sink into terrain and z-fight at grazing angles; the negative-z `eyeOffset` fixes it, and the sign is only right because eye coordinates are left-handed with +z INTO the screen.

## How to test
No test file exists for this slice. `npm test -w apps/web` covers its neighbours only; verify by `npm run dev` and looking at the globe (`CLAUDE.md` → *Verification*). No API, no Docker.
