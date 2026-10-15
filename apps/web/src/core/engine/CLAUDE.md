## Owns
The non-React Cesium machinery: the viewer factory, its scene settings and teardown (`destroyOrbitalViewer`), the render-density / pick-window math (`displayDensity`), basemap swapping, the one-way sim-clock sync, the keyboard/follow `CameraRig`, the world-oriented `WorldDecal`, the programmatic icon sprites every layer tints, the fixed signal hues (`signalColors`) and the surface-glyph `travelAxis`.

## Depends on
`cesium` only (plus `VITE_CESIUM_TOKEN` from the Vite env) — no React and no hooks; `app/GlobeView` composes it directly. Nothing here imports from `features/` — rule 3 of `docs/ARCHITECTURE.md`. Consumed by `app/GlobeView` and, for `icons` / `signalColors` / `travelAxis`, by the layer slices. A risk path in `.claude/kit.profile.yaml`: a leak here is invisible until runtime, so dispatch `@cesium-engine` before editing.

## Invariants
- Every Cesium resource created has a matching destroy path (`CameraRig.dispose`, `WorldDecal.dispose`, `destroyOrbitalViewer` — which also removes the `.cesium-credits` div the factory appended; a throwing `new Viewer` gets that div and Viewer.js's orphaned `.cesium-viewer` div removed by the factory itself), and every public method returns early on `isDestroyed()`.
- The app runs token-free by design: without `VITE_CESIUM_TOKEN`, `Ion` is never touched at all (no token set, no Ion asset requests). A token adds terrain only; imagery still comes from the keyless basemap.
- The sim-clock store is the source of truth and the sync is ONE-WAY: `shouldAnimate = false` plus `ClockStep.SYSTEM_CLOCK_MULTIPLIER`, so Cesium never advances or overwrites time itself.
- `requestRenderMode` stays off — the scene animates every frame. `showRenderLoopErrors` is off too: the host owns `scene.renderError` (GlobeView rebuilds the engine on WebGL context loss). The host owns picking too: `createViewer.ts:155` strips Viewer's default LEFT_CLICK select / LEFT_DOUBLE_CLICK track actions (an uncaught `DeveloperError` on a tap during context loss, a redundant pick pass, `trackedEntity` fighting `CameraRig`) — never rely on `selectedEntity` / `trackedEntity`.
- Per-frame code allocates nothing: `syncViewerClock`, `WorldDecal.setPose` and `CameraRig.update` reuse module-scope scratches.
- Icon glyphs are white on transparent 64×64 canvases, memoized to one element each, and rotatable ones point UP so a billboard rotation of 0 is nose-up. Non-palette tints (selection amber, ground-track cyan) come only from `signalColors`, whose literals mirror `styles/tokens.css` — `signalColors.test.ts` pins each pair.
- Attribution stays visible (legal): credits get their own restyled container, never `creditContainer` suppression.

## Traps
- `createViewer.ts:230` — `Clock#currentTime`'s setter STORES the reference it is handed rather than cloning, so a shared scratch `JulianDate` must never be assigned to it; write into the clock's own instance via the `result` parameter.
- `createViewer.ts:170` — fog culls far tiles, culled tiles write no depth, and billboards *beyond the horizon* then showed through the planet. Fog is off so the globe occludes all the way to the limb.
- `createViewer.ts:96` — render in device px (`useBrowserRecommendedResolution: false`; the default upscales a CSS-res canvas and blurs tiles and labels), capped at an effective DPR of 2 by `applyRenderDensity`. Tile LOD does NOT depend on DPR (`QuadtreePrimitive` divides SSE by `pixelRatio`), and billboard/label/polyline/point sizes are already CSS px at any DPR (their shaders multiply by `czm_pixelRatio`) — never DPR-scale layer sizes. Only the pick rectangle is drawing-buffer px: size it with `displayDensity.pickWindowPx`.
- `CameraRig.ts:180` — follow-lock drifted: `lookAtTransform` without offset keeps world position, found 2026-10-14 on fix/mobile-layout. `Camera._setTransform` re-expresses the camera's WORLD pose in the new frame, so re-calling `lookAtTransform(enu)` per frame parked the camera while the ISS slid off-screen still LOCKED. Save the frame-local `position`/`direction`/`up`, move the frame, restore them; a camera found in `IDENTITY` (a flight dropped the frame) is re-adopted world-preserving instead.
- `createViewer.ts:165` — `depthTestAgainstTerrain = true` is what makes every surface-level layer need a camera-ward `eyeOffset`; changing it here changes four slices.

## How to test
`npm test -w apps/web -- displayDensity` covers the pure density / pick-window math; `-- CameraRig` drives a real `Camera` on a fake scene (no WebGL) and pins the follow offset; `-- travelAxis` checks against Cesium's own ENU frame; `-- signalColors` pins the tokens mirror. None of them sees a leak that shows after minutes or what is actually on screen. Verify with `npm run dev` and watch — `CLAUDE.md` → *Verification*. No API, no Docker.
