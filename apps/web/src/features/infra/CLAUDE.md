## Owns
The two static ground overlays: orbital launch sites (amber rocket) and major ports (cyan anchor), each a billboard collection plus a label collection built once in its constructor.

## Depends on
`core/engine/icons.rocketIcon` / `icons.anchorIcon` and the committed datasets `src/data/launchSites.json` and `src/data/ports.json`, whose row shape is mirrored by the exported `LaunchSite` / `Port` interfaces. `app/GlobeView` owns both layers' lifetimes and routes picks; `app/LayersPanel` toggles them. No other slice may import from here.

## Invariants
- Every Cesium object created has a destroy path: `dispose()` removes both collections, and `PrimitiveCollection.destroyPrimitives` defaults to true, so `remove()` destroys them.
- Nothing runs per frame here — the layer is static, so the shared scratch `Cartesian3` is constructor-only and the sites are never rebuilt.
- One fixed atlas image id per layer, so all sites share a single texture-atlas entry.
- Billboards and labels keep the default `disableDepthTestDistance`, so they hide behind the globe; labels additionally carry `DistanceDisplayCondition(0, 12_000_000)` so names disappear at globe range instead of piling up.
- Icons carry no rotation — an upright rocket or anchor reads at any camera heading.
- `pick()` returns a site/port id only when the picked primitive belongs to *this* layer, so two overlays cannot claim each other's hits.
- The two files are deliberate near-duplicates; a change to one is almost always a change to both.

## Traps
- `LaunchSitesLayer.ts:49` (and `PortsLayer.ts:49`) — with `scene.globe.depthTestAgainstTerrain` on (`apps/web/src/core/engine/createViewer.ts:121`), surface-level billboards half-sink into terrain and z-fight at grazing angles; the negative-z `eyeOffset` fixes it, and the sign is only right because eye coordinates are left-handed with +z INTO the screen.

## How to test
No test file exists for this slice. `npm test -w apps/web` covers its neighbours only; verify by `npm run dev` and looking at the globe (`CLAUDE.md` → *Verification*). No API, no Docker.
