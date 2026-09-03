# AGENTS.md — AI context map for cesium-satellite-tracker

Read this, then `CLAUDE.md` (rules) and `.claude/kit.profile.yaml` (values). Map, not law.

## What this is

**ORBITAL OPS** — a real-time satellite, ship and aircraft tracker on a CesiumJS globe, live at
orbit.irminsul.uk. npm-workspaces monorepo: `apps/web` (React 19 + Vite + CesiumJS + zustand),
`apps/api` (Hono + `node:sqlite` TLE cache + live AIS/ADS-B feeds on `:8787`), `packages/shared`
(zod contracts both sides import). Satellites are propagated with SGP4 (`satellite.js`) in a Web
Worker; ships and aircraft are polled live and degrade cleanly without keys. Both apps are
vertical slices (`docs/ARCHITECTURE.md`). Ships as one Docker image (the API serves the built web)
to the `cloud` box; a merge to `main` is a deploy (`docs/DEPLOY.md`).

## Where things live

```
apps/web/src/
  app/            composition root — GlobeView owns the viewer, layers, worker and render loop
  core/engine/    non-React Cesium machinery (createViewer, CameraRig, WorldDecal) — risk path
  core/sim/       the warpable simulation clock
  core/ui/        cross-slice zustand stores (mode, follow, prefs)
  features/       one folder per slice: catalog, constellation, tracking, passes, timebar,
                  maritime, airspace, infra — UI, store and Cesium layer together
  lib/            pure helpers: api client, orbital math, formatters
  workers/        propagation.worker.ts — batch SGP4 (nothing in the repo is named "sgp4")
  data/           committed static datasets (launch sites, ports)
  styles/         tokens.css — the HUD palette every panel reads
apps/api/src/
  app.ts          composition root: CORS, rate limit, mounts the slice routers
  index.ts        bootstrap: env, SQLite, seed, feeds, listen — the only file reading process.env
  satellites/ ships/ aircraft/   one slice each: feed + routes (factories taking injected deps)
apps/api/seed/    committed TLE snapshot that boots the API offline — regenerate, never hand-edit
apps/api/test/    Vitest endpoint tests against in-memory SQLite with a fake fetcher and clock
packages/shared/  @orbital-ops/shared — zod schemas, the API contract
docs/             ARCHITECTURE, API, CONTROLS, DEPLOY, DEVELOPMENT; superpowers/specs/ = design
.claude/
  agents/         cesium-engine, orbital-mechanics, hud-designer — the specialists CLAUDE.md routes to
  workflows/      deep-review.js, parallel-features.js — Workflow-tool scripts
.github/workflows/  ci.yml (PR gate), deploy.yml (main → GHCR → cloud box), prune-ghcr.yml
```

**Open first:**

1. `docs/superpowers/specs/2026-07-10-orbital-ops-refactor-design.md` — the design and why this shape
2. `docs/ARCHITECTURE.md` — the slice rules reviews enforce
3. `apps/web/src/app/GlobeView.tsx` — the one mount effect that owns everything on the globe
4. `apps/web/src/features/maritime/` — a complete web slice to copy (layer + store + panel + tests)
5. `apps/api/src/ships/` with `apps/api/test/ais.test.ts` — a complete API slice and its test

## Build / test / run

From `.claude/kit.profile.yaml` `commands:` and `docs/DEVELOPMENT.md`. Node ≥ 22.12 (CI runs 24).

```sh
npm install                     # postinstall copies Cesium assets into apps/web/public/cesium/
npm run dev                     # api on :8787 + web on :5173; Vite proxies /api
npm run build                   # shared + api are typecheck-only (tsc --noEmit); web bundles
npm test                        # every workspace, --if-present
npm run lint && npm test        # commands.check — the Stop gate after any source change
npm test -w apps/api            # one workspace (also apps/web, packages/shared)
npm run seed:make -w apps/api   # refresh the committed TLE seed from CelesTrak — fetch politely
docker compose up -d --build    # the production shape locally, bound to 127.0.0.1:8787
```

Env is optional everywhere: `apps/api/.env.example` (AIS and OpenSky keys), `VITE_CESIUM_TOKEN` in
a Vite env file for Ion terrain (`docs/DEVELOPMENT.md` → *Environment files*). Nothing needs Docker except the compose line.

## Conventions (pointers)

- Skill and agent routing, and the two failure modes it exists for: `CLAUDE.md` → *Skills and agents*.
- No cross-slice imports, Cesium out of React, every create has a destroy: `CLAUDE.md` → *Architecture*, detail in `docs/ARCHITECTURE.md`.
- Branch, commit format, PR into `main` is a deploy: `CLAUDE.md` → *Git workflow*; values in the profile's `git:` and `pr:`.
- Risk paths (engine, workers, propagators, CI, Docker) and the enforced `skill_routes`: `.claude/kit.profile.yaml`.
- What a green suite does not prove, and how to verify instead: `CLAUDE.md` → *Verification*.

## Common tasks

| Task | Start here |
| --- | --- |
| Add or change a web feature slice | copy `apps/web/src/features/maritime/`; the profile gates the first write on `frontend-slice-architecture` |
| Touch the viewer, camera or primitives | dispatch `@cesium-engine` (`.claude/agents/cesium-engine.md`); everything created gets a destroy path |
| Positions, TLEs, frames, passes | dispatch `@orbital-mechanics`; `apps/web/src/lib/orbital.ts` and `apps/web/src/workers/propagation.worker.ts` |
| Anything visual in the HUD | dispatch `@hud-designer`; tokens in `apps/web/src/styles/tokens.css` |
| Add an API endpoint or feed | copy `apps/api/src/ships/`, mount in `apps/api/src/app.ts`, schema in `packages/shared/src/index.ts`, document in `docs/API.md` |
| Review a branch before merging | `.claude/workflows/deep-review.js` via the Workflow tool, or `/review` |

## Gotchas

- `apps/web/public/cesium/` and `apps/api/data/` are gitignored and generated (at `npm install` and first boot). A clone without `npm install` has no globe assets; the committed truth is `apps/api/seed/`, not `apps/api/data/`.
- `npm run lint && npm test` cannot catch the two bugs that matter here — a Cesium leak that shows after minutes of runtime, and a wrong-but-plausible position. `CLAUDE.md` → *Verification*: run it and watch.
- The profile's `risk_paths` record that an earlier `**/*sgp4*` glob matched nothing; SGP4 lives in `apps/web/src/workers/propagation.worker.ts`.
- `README.md` hero copy carries object counts and a "Last Updated" month that nothing regenerates; treat them as prose, not facts.
- `apps/api` runs TypeScript directly under Node (`node src/index.ts`); its `build` is `tsc --noEmit`, so a type error shows in `npm run build`, not in `npm run dev`.
