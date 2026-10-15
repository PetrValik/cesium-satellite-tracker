# Architecture — Vertical Slice rules

Both apps are organized as **vertical slices**: a feature owns its UI, state,
and domain logic in one folder. The dependency rules below are what reviews
enforce.

## apps/web

```
src/
├── App.tsx       # top-level composition root: mounts app/, starts slice polling
├── app/          # composition: GlobeView + globe/ (the non-React globe build), HUD, panels, selection
├── core/
│   ├── engine/   # non-React Cesium machinery (viewer, CameraRig, tap picking, renderer health)
│   ├── sim/      # simulation clock + coarse wall clock
│   └── ui/       # cross-domain UI state (mode, follow, prefs, hud, sheet) + shared atoms
├── features/     # one folder per slice
│   ├── catalog/        # satellite groups, search, satellite selection
│   ├── constellation/  # whole-catalog rendering
│   ├── tracking/       # selected satellite: propagation, visuals, telemetry
│   ├── passes/         # pass prediction + sky plot
│   ├── timebar/        # transport bar
│   ├── maritime/       # AIS ships: layer, store, panels
│   ├── airspace/       # ADS-B aircraft: layer, store, panels
│   └── infra/          # static overlays: launch sites, ports
├── lib/          # pure helpers: api client, orbital math, formatters
├── workers/      # propagation worker
└── data/         # committed static datasets
```

**Rules**

1. A slice may import from `core/`, `lib/`, `data/`, and `@orbital-ops/shared`
   — never from another slice's folder.
   *Exception:* satellite-domain slices (`tracking`, `passes`,
   `constellation`) may read `catalog/catalogStore` — it is the satellite
   domain's entity/selection store.
2. Only `app/` and `src/App.tsx` compose slices. If two slices need to meet,
   they meet there or through a `core/ui` store.
3. `core/` never imports from `features/`.
4. Per-mode UI lives in the owning slice (`MaritimePicture`, `AirPicture`),
   not in a shared panel.

## apps/api

```
src/
├── app.ts        # composition: secure headers, rate limit, CORS, mounts slice
│                 #   routers, /api/live/status, /api 404, static web + SPA fallback
├── index.ts      # bootstrap: env, SQLite, feeds, server, SIGTERM/SIGINT shutdown
├── shared/       # cross-slice HTTP helpers (rateLimit, guards) — not the
│                 #   @orbital-ops/shared contract package
├── satellites/   # TLE cache slice: celestrak, db, refresh, seed, routes
├── ships/        # AIS slice: ais feed, routes
└── aircraft/     # ADS-B slice: adsb feed, routes
```

**Rules**

1. Slices are independent — they never import each other. Only `app.ts` and
   `index.ts` see more than one slice; slices may import `shared/`, and
   `shared/` imports no slice.
2. Response contracts live in `packages/shared` (zod) and are consumed by
   both the API and the web client.
3. Every slice's routes are a factory taking injected deps (`db`, `fetcher`,
   feeds) so tests run against fakes.

## apps/web styles

Plain global CSS, no CSS modules. `src/main.tsx` imports `src/styles/index.css`,
which `@import`s `tokens.css` (custom properties: palette, type scale, spacing,
shared geometry) and then one file per HUD component or area.

1. A component's rules live in one file, with its hover, touch, compact,
   landscape, hidden-HUD and reduced-motion overrides next to the rule they
   override. Class names are global, so files are named after components,
   not slices.
2. The `@import` order in `styles/index.css` is part of the cascade (at equal
   specificity the later file wins); the order dependencies are listed in
   that file's header.
3. Colours come from `tokens.css` or from the user palette
   (`core/ui/prefsStore`, applied through `--hue`); no new colour literal in
   component CSS or TSX.
