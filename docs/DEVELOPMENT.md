# Development

Local setup for Orbital Ops — an npm-workspaces monorepo (React 19 + Cesium web
app, Hono API, shared zod contracts).

## Prerequisites

- **Node.js ≥ 22.12** — `node:sqlite` and `--env-file-if-exists` are built
  in, so there are no native dependencies. CI runs on Node 24.
- No Cesium Ion token required. The globe falls back to OpenStreetMap imagery +
  ellipsoid terrain; set `VITE_CESIUM_TOKEN` for Cesium World Terrain.

## Quickstart

```bash
git clone <repository-url>
cd cesium-satellite-tracker
npm install          # also copies Cesium static assets (web postinstall)
npm run dev          # api on :8787 + web on :5173
```

`npm run dev` runs both workspaces concurrently. Open the web app at
**http://localhost:5173**; Vite proxies `/api` to the API on **:8787**. The
satellite catalog works offline immediately from the committed TLE seed.

Run one side alone with `npm run dev:api` or `npm run dev:web`.

## Workspace layout

```
apps/
├── api/        # @orbital-ops/api — Hono + node:sqlite TLE cache + live feeds (:8787)
└── web/        # @orbital-ops/web — Vite + React 19 + CesiumJS (:5173 in dev)
packages/
└── shared/     # @orbital-ops/shared — zod schemas, the API contract
```

Root scripts fan out across workspaces:

| Command | What it does |
|---|---|
| `npm run dev` | api + web together (concurrently) |
| `npm run build` | build `packages/shared`, typecheck `apps/api`, bundle `apps/web` |
| `npm test` | run every workspace's tests (`--if-present`) |
| `npm run lint` | eslint across the monorepo |
| `npm run preview` | preview the built web app |

## Testing

Tests run under Vitest. Run all with `npm test`, or per workspace:

| Workspace | Command | Covers |
|---|---|---|
| `apps/api` | `npm test -w apps/api` | endpoint tests against an in-memory SQLite DB with an injected fake fetcher and clock: TTL, stale-while-revalidate, offline 503s, failure cooldown, search escaping |
| `apps/web` | `npm test -w apps/web` | orbital math pinned to a real ISS TLE (period, altitude, velocity, ground-track bounds, pass windows), sim-clock semantics, mode/ships/aircraft stores, formatters |
| `packages/shared` | `npm test -w packages/shared` | zod schema round-trips |

## Environment files

The web app reads Vite env vars from `apps/web/.env`:

```bash
echo "VITE_CESIUM_TOKEN=your_token_here" > apps/web/.env   # optional: Ion terrain
```

The API reads live-feed credentials from the environment (or `apps/api/.env` —
copy `apps/api/.env.example`). All are optional; the feeds degrade without them:

- `AISSTREAM_API_KEY` — enables the live ship (AIS) feed; without it `/api/ships`
  returns 503 and the MARITIME panel shows AIS OFFLINE.
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` — 60 s aircraft polling instead
  of anonymous 600 s.

See [API.md](API.md#environment-reference) for the full env reference (`PORT`,
`DATA_DIR`, `WEB_DIST`, `ALLOWED_ORIGINS`, `TRUST_PROXY`).

## Regenerating the TLE seed

The committed offline snapshot under `apps/api/seed/*.tle` boots the API without
network. Refresh it from CelesTrak with:

```bash
npm run seed:make -w apps/api
```

Please fetch politely — the caching API exists precisely so CelesTrak isn't hit
per visitor.

## Contributing

Both apps are organized as **vertical slices** with dependency rules that
reviews enforce (slices don't import each other; only the app layer / `app.ts`
composes them; response contracts live in `packages/shared`). Read
[ARCHITECTURE.md](ARCHITECTURE.md) before adding a feature.
