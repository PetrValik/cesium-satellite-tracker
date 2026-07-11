# Architecture — Vertical Slice rules

Both apps are organized as **vertical slices**: a feature owns its UI, state,
and domain logic in one folder. The dependency rules below are what reviews
enforce.

## apps/web

```
src/
├── app/          # composition root: GlobeView, LeftRail, ModeTabs, StatusLine,
│   │             #   LayersPanel (cross-domain layer toggles), HelpOverlay
├── core/
│   ├── engine/   # non-React Cesium machinery (viewer, CameraRig)
│   ├── sim/      # simulation clock
│   └── ui/       # cross-domain UI state (mode, follow) + shared atoms
├── features/     # one folder per slice
│   ├── catalog/        # satellite groups, search, satellite selection
│   ├── constellation/  # whole-catalog rendering
│   ├── tracking/       # selected-satellite visuals + telemetry
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
2. Only `app/` composes slices (LeftRail, GlobeView, App). If two slices need
   to meet, they meet there or through a `core/ui` store.
3. `core/` never imports from `features/`.
4. Per-mode UI lives in the owning slice (`MaritimePicture`, `AirPicture`),
   not in a shared panel.

## apps/api

```
src/
├── app.ts        # composition: CORS, mounts slice routers, /api/live/status
├── index.ts      # bootstrap: env, feeds, server
├── satellites/   # TLE cache slice: celestrak, db, refresh, seed, routes
├── ships/        # AIS slice: ais feed, routes
└── aircraft/     # ADS-B slice: adsb feed, routes
```

**Rules**

1. Slices are independent — they never import each other. Only `app.ts` and
   `index.ts` see more than one slice.
2. Response contracts live in `packages/shared` (zod) and are consumed by
   both the API and the web client.
3. Every slice's routes are a factory taking injected deps (`db`, `fetcher`,
   feeds) so tests run against fakes.
