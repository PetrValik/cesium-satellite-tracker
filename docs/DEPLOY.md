# Deploying Orbital Ops (Hetzner / any Linux box)

One container runs everything: the API on `:8787` also serves the built web
app. Satellite data works offline out of the box (committed TLE seed);
CelesTrak refreshes itself. Aircraft work anonymously; ships need a free
aisstream.io key.

## 1. Quick start (Docker Compose)

```bash
git clone <repo> && cd cesium-satellite-tracker

# optional live-feed keys
cat > .env <<'ENV'
AISSTREAM_API_KEY=...        # free: https://aisstream.io
OPENSKY_CLIENT_ID=...        # optional, free: https://opensky-network.org
OPENSKY_CLIENT_SECRET=...
ENV

docker compose up -d --build
curl -s http://127.0.0.1:8787/api/health
```

The container binds to `127.0.0.1:8787` only — put a reverse proxy with TLS
in front of it. The SQLite cache lives in the `orbital-ops-data` volume.

## 2. Reverse proxy (Caddy)

```caddy
orbital.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

nginx equivalent: `proxy_pass http://127.0.0.1:8787;` + `proxy_set_header
X-Forwarded-For $proxy_add_x_forwarded_for;`.

`TRUST_PROXY=1` (set in docker-compose) makes the API read the client IP from
`X-Forwarded-For` for rate limiting — only enable it behind a proxy you
control.

## 3. Environment reference

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | API listen port |
| `DATA_DIR` | `/data` (container) | SQLite cache location |
| `WEB_DIST` | set in image | serve the web build from this dir; unset = API only |
| `AISSTREAM_API_KEY` | — | enables the ships feed |
| `OPENSKY_CLIENT_ID/SECRET` | — | 60 s aircraft polling instead of 600 s anonymous |
| `TRUST_PROXY` | `0` | trust `X-Forwarded-For` (behind reverse proxy only) |
| `ALLOWED_ORIGINS` | — | comma-separated CORS allowlist; unset = same-origin only |

## 4. Automatic deploys (GitHub Actions)

Every push to `main` runs `.github/workflows/deploy.yml`: lint + build +
tests → Docker image → GHCR → SSH to the server → `docker compose pull &&
up -d` → health check. Manual runs via *workflow_dispatch*.

One-time setup:

1. **Server**: clone the repo (or just copy `docker-compose.yml` + `.env`)
   into a directory, e.g. `/opt/orbital-ops`. If the GHCR package is private,
   `docker login ghcr.io -u <user> -p <PAT with read:packages>` once.
2. **GitHub repo → Settings → Environments**: create `production`.
3. **Secrets** (repo or environment scope):

   | Secret | Value |
   |---|---|
   | `DEPLOY_HOST` | server IP / hostname |
   | `DEPLOY_USER` | SSH user (needs docker group) |
   | `DEPLOY_SSH_KEY` | private key for that user (dedicated deploy key) |
   | `DEPLOY_PATH` | e.g. `/opt/orbital-ops` (where docker-compose.yml lives) |

The live-feed keys stay in the server-side `.env` next to
`docker-compose.yml` — they never enter GitHub.

## 5. Manual updating

```bash
git pull && docker compose up -d --build
```

## 6. PWA (service worker)

Production builds only: `vite build` stamps `apps/web/pwa/sw.template.js` into
`dist/sw.js` (plugin in `apps/web/vite.config.ts`), and `src/main.tsx`
registers `/sw.js` after page load. `vite dev` never registers one.

**What it caches** (two Cache Storage entries, both prefixed `oo-`):

| Cache | Holds | Filled |
|---|---|---|
| `oo-shell-<build id>` | `/` (the offline shell), `manifest.webmanifest`, `favicon.ico`, `icon.svg`, `apple-touch-icon.png`, the manifest's icons, every hashed file under `/assets/` | at install; the shell and the unhashed files past the HTTP cache |
| `oo-cesium-<Cesium version>` | `/cesium/*` (Cesium's unhashed workers and assets) | on first use, cache first; kept across deploys that do not bump Cesium |

The build id is a hash of the template, `index.html`, the precache list, the
Cesium version and the bytes of the unhashed public files, so the same inputs
give the same `sw.js`. The build fails if the manifest or any icon it lists is
missing from `dist/`.

Navigations are network first: the precached shell is served only offline,
after 4 s without an answer, or on a 5xx (e.g. a 502 while the container
restarts).

**Never intercepted:** `/api` and `/api/*` (live data always comes from the
network), every cross-origin request (imagery tiles, Cesium Ion, photo APIs),
non-GET, `Range` and `only-if-cached` requests, and `/sw.js` itself. Any other
same-origin path outside the precache, `/assets/` and `/cesium/` passes
through as well.

**How an update reaches open clients:** the browser re-checks `/sw.js` past
the HTTP cache on navigations. A deploy that changes the build id installs a
new worker, which precaches the new build (a failed precache fails the
install and the old worker stays), skips waiting, deletes every other `oo-*`
cache and claims open pages. There is no in-page reload prompt: an open tab
keeps the code it loaded, and its next load boots the deployed `index.html`.

**Kill switch:** ship a `sw.js` that deletes every `oo-*` cache and calls
`self.registration.unregister()`, then redeploy. The stamp step requires the
three placeholders, so keep them when replacing the template:

```js
const BUILD_ID = '__BUILD_ID__'
const CESIUM_VERSION = '__CESIUM_VERSION__'
const PRECACHE = __PRECACHE__

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('oo-')) await caches.delete(key)
      await self.registration.unregister()
    })(),
  )
})
```

## 7. Notes

- The seed refreshes automatically from CelesTrak (stale-while-revalidate,
  6 h TTL, per-group failure cooldown) — no cron needed.
- Rate limiting is per-IP in-memory; a container restart resets it.
- Nothing needs outbound access except celestrak.org, opensky-network.org,
  and stream.aisstream.io (443).
