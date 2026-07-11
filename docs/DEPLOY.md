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

## 6. Notes

- The seed refreshes automatically from CelesTrak (stale-while-revalidate,
  6 h TTL, per-group failure cooldown) — no cron needed.
- Rate limiting is per-IP in-memory; a container restart resets it.
- Nothing needs outbound access except celestrak.org, opensky-network.org,
  and stream.aisstream.io (443).
