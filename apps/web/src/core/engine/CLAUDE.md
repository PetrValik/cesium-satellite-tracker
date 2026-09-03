## Owns
The non-React Cesium machinery: the viewer factory and its scene settings, basemap swapping, the one-way sim-clock sync, the keyboard/follow `CameraRig`, the world-oriented `WorldDecal`, and the programmatic icon sprites every layer tints.

## Depends on
`cesium` only (plus `VITE_CESIUM_TOKEN` from the Vite env). Nothing here imports from `features/` — rule 3 of `docs/ARCHITECTURE.md`. Consumed by `app/GlobeView` and, for `icons`, by every layer slice. A risk path in `.claude/kit.profile.yaml`: a leak here is invisible until runtime, so dispatch `@cesium-engine` before editing.

## Invariants
- No React in this folder; components reach it through thin hooks.
- Every Cesium resource created has a matching destroy path (`CameraRig.dispose`, `WorldDecal.dispose`), and every public method returns early on `isDestroyed()`.
- The app runs token-free by design: without `VITE_CESIUM_TOKEN`, `Ion` is never touched at all (no token set, no Ion asset requests). A token adds terrain only; imagery still comes from the keyless basemap.
- The sim-clock store is the source of truth and the sync is ONE-WAY: `shouldAnimate = false` plus `ClockStep.SYSTEM_CLOCK_MULTIPLIER`, so Cesium never advances or overwrites time itself.
- `requestRenderMode` stays off — the scene animates every frame.
- Per-frame code allocates nothing: `syncViewerClock` and `WorldDecal.setPose` reuse module-scope scratches.
- Icon glyphs are white on transparent 64×64 canvases, memoized to one element each, and rotatable ones point UP so a billboard rotation of 0 is nose-up.
- Attribution stays visible (legal): credits get their own restyled container, never `creditContainer` suppression.

## Traps
- `createViewer.ts:160` — `Clock#currentTime`'s setter STORES the reference it is handed rather than cloning, so a shared scratch `JulianDate` must never be assigned to it; write into the clock's own instance via the `result` parameter.
- `createViewer.ts:126` — fog culls far tiles, culled tiles write no depth, and billboards *beyond the horizon* then showed through the planet. Fog is off so the globe occludes all the way to the limb.
- `createViewer.ts:110` — `useBrowserRecommendedResolution` is left at the default `true` on hi-DPI displays, which upscales the whole scene 2× and reads as blurry tiles and labels.
- `createViewer.ts:121` — `depthTestAgainstTerrain = true` is what makes every surface-level layer need a camera-ward `eyeOffset`; changing it here changes four slices.

## How to test
No test file exists in this folder, and neither `npm run lint` nor `npm test` can see its two failure modes (a leak that shows after minutes, a wrong-but-plausible camera frame). Verify with `npm run dev` and watch — `CLAUDE.md` → *Verification*. No API, no Docker.
