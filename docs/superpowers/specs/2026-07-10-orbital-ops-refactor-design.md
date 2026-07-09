# Orbital Ops — refactor & boost design

**Date:** 2026-07-10 · **Status:** approved for implementation (autonomous session, design authority delegated)

## Problem

The repo is a "hello 3D globe" foundation: React 19 + Vite + CesiumJS with terrain and OSM buildings, zero satellite functionality, no tests, no UI, and a hard dependency on a Cesium Ion token (the app renders nothing without one). The README promises a satellite tracker; the code doesn't contain one.

Goal (from the owner): fix the solution and boost it visually and architecturally; backend + database allowed; UI must be original, not a generic dashboard.

## What we build

A working real-time satellite tracker — **"Orbital Ops"** — delivering the README's Phase 1–3 promises:

1. Live TLE catalog (CelesTrak) served by a small caching backend.
2. SGP4 propagation of whole satellite groups in a Web Worker; thousands of satellites rendered as GPU point primitives.
3. Selected-satellite tracking: smooth per-frame position, orbit path, ground track, telemetry readout.
4. Simulation time control: play/pause, warp multipliers, scrub, return-to-now.
5. Pass prediction for an observer location with a polar sky plot (the signature widget).
6. A distinctive avionics-HUD visual language (see UI section).

Out of scope (YAGNI): conjunction analysis, GeoJSON import/export, measurement tools, user accounts, ground-station persistence.

## Approaches considered

- **A. Pure frontend** (fetch CelesTrak from browser + IndexedDB cache): simplest, but hammers CelesTrak per visitor (they throttle), no server-side search, CORS at their mercy. Rejected.
- **B. Monorepo with thin caching API + SQLite (chosen):** npm workspaces — `apps/web`, `apps/api`, `packages/shared`. The API is a polite shared TLE cache (CelesTrak asks consumers to fetch at most every ~2 h), enables search/groups endpoints, and the committed TLE seed makes the whole app run offline. SQLite via **`node:sqlite`** (built into Node ≥ 22.5; zero native deps).
- **C. Full product backend** (Postgres, auth, user data): overkill for a portfolio tracker. Rejected.

## Architecture

```
cesium-satellite-tracker/
├── package.json                  # npm workspaces root: dev/build/test/lint fan-out
├── apps/
│   ├── api/                      # Hono + @hono/node-server + node:sqlite
│   │   ├── src/
│   │   │   ├── index.ts          # bootstrap: seed DB if empty → serve :8787
│   │   │   ├── app.ts            # Hono app factory (injectable fetcher+db → testable)
│   │   │   ├── db.ts             # node:sqlite schema + queries
│   │   │   ├── celestrak.ts      # GP endpoint fetcher, TLE parser
│   │   │   ├── refresh.ts        # stale-while-revalidate per group, 6 h TTL
│   │   │   └── groups.ts         # curated group list (stations, starlink, gps-ops, …)
│   │   ├── seed/*.tle            # committed snapshot → app works offline
│   │   └── test/                 # vitest: endpoints w/ temp DB + fake fetcher
│   └── web/                      # Vite + React 19 + Cesium
│       └── src/
│           ├── app/              # App.tsx, layout shell
│           ├── core/
│           │   ├── engine/       # non-React Cesium wrapper: viewer factory,
│           │   │                 #   token-free fallback (OSM imagery + ellipsoid
│           │   │                 #   terrain) vs Ion (world terrain + buildings)
│           │   └── sim/          # simulation clock (Zustand): simTime, rate, playing
│           ├── workers/          # propagation.worker.ts (satellite.js SGP4 batch
│           │                     #   → Float32Array ECEF; pass prediction jobs)
│           ├── features/
│           │   ├── catalog/      # groups, search, list, selection
│           │   ├── constellation/# PointPrimitiveCollection renderer, orbit-class colors
│           │   ├── tracking/     # selected sat: per-frame propagation, orbit line,
│           │   │                 #   ground track, footprint, telemetry panel
│           │   ├── passes/       # observer, pass prediction, sky plot, pass list
│           │   └── timebar/      # transport bar: play/pause/warp/scrub/NOW + UTC
│           ├── lib/              # api client, formatters, orbital helpers
│           └── styles/           # tokens.css + global.css (design system)
└── packages/
    └── shared/                   # zod schemas + TS types for the API contract
```

**Data flow:** CelesTrak → api cache (SQLite, 6 h TTL, stale-while-revalidate, seed fallback) → `/api/*` → web catalog store → worker (`satellite.js` SGP4, ticks on sim time) → `Float32Array` ECEF positions → Cesium `PointPrimitiveCollection`. The **selected** satellite is propagated on the main thread every frame for smoothness; the constellation updates at 1 Hz (positions move imperceptibly at globe scale between ticks).

**API contract** (zod in `packages/shared`):
- `GET /api/health` → `{ ok, satCount, groups }`
- `GET /api/groups` → `[{ slug, name, count, updatedAt, stale }]`
- `GET /api/satellites?group=<slug>` → `[{ noradId, name, tle1, tle2, groups }]`
- `GET /api/satellites/search?q=` → same shape, name/NORAD-id match
- `GET /api/satellites/:noradId` → single

**Time model:** one Zustand sim-clock store is the source of truth (`epochMs`, `rate ∈ {-60, 1, 10, 60, 600, 3600}`, `playing`). Each rAF advances it and syncs `viewer.clock`; the worker receives the current sim time with each tick request. Scrubbing = set epoch directly; "NOW" resets to wall clock, rate 1.

**Error handling:** api degrades CelesTrak failures to stale cache (never 500 if it has data, `stale: true` flag instead); web shows TLE age in the status line and an offline badge when `/api` is unreachable; Cesium init failures render a readable fallback screen instead of a black void.

## UI — the original part

Concept: **avionics multi-function displays, not a web dashboard.** The globe is fullscreen; UI lives in corner-anchored instrument clusters with chamfered (clip-path) corners and hairline borders, as if projected on a mission-console HUD.

- **Palette:** near-black space `#06090f`; hairlines `rgba(255,255,255,.08)`; primary accent **signal amber** (CRT warmth, deliberately not radar-green); secondary cyan for orbit geometry; orbit-class hues for constellation points (LEO/MEO/GEO/HEO).
- **Type:** monospace for all data (tabular numerals, live counters), tight uppercase letter-spaced labels.
- **Signature widgets:** bottom **transport bar** (tape-deck time control with UTC readout and warp indicator); **polar sky plot** (az/el pass radar for the observer); top status line ("TRACKING 2 341 OBJECTS · TLE AGE 3 H · SIM ×60").
- **Moments:** "ACQUIRING CATALOG…" boot overlay during first TLE load; day/night terminator on the globe (`enableLighting`); selected satellite gets a callout label + amber orbit.
- Hand-rolled components + CSS custom-prop tokens; no component framework. `frontend-design` skill governs the pass; `dataviz` skill governs the sky plot.

## Testing

- `packages/shared`: schema round-trips.
- `apps/api`: endpoint tests via Hono `app.request()` with temp DB + injected fake fetcher (fresh fetch, TTL, stale-while-revalidate, seed load, search).
- `apps/web`: vitest for the math-critical bits — TLE→orbit-class classification, pass-prediction against a pinned ISS TLE fixture (known-good windows), sim-clock store logic, formatters.
- E2E: manual drive via Chrome DevTools MCP (catalog load, select ISS, warp, passes) + screenshots for README.

## Compatibility & fixes folded in

- **Runs without a Cesium Ion token** (falls back to OSM imagery + ellipsoid terrain; Ion terrain + OSM buildings light up when `VITE_CESIUM_TOKEN` is set). Fixes the current hard token dependency.
- Committed TLE seed → runs without network.
- Node ≥ 22.5 required (for `node:sqlite`) — repo has Node 24.
- Existing modular `src/cesium/*` helpers survive conceptually inside `core/engine`.
