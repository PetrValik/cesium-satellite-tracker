## Owns
The TLE cache slice: the curated CelesTrak group list, the fetcher and 3-line TLE parser, the `node:sqlite` store, the stale-while-revalidate `Refresher`, the committed-seed loader, and the `/api/health`, `/api/groups`, `/api/satellites*` routes.

## Depends on
CelesTrak's GP endpoint (`gp.php?GROUP=&FORMAT=tle`), the SQLite file `apps/api/data/` (gitignored, generated on first boot), the committed snapshot `apps/api/seed/*.tle` + `seed/meta.json`, and `Satellite`/`GroupInfo` from `@orbital-ops/shared`. Mounted by `app.ts`. Never imports the `ships` or `aircraft` slices.

## Invariants
- Routes are a factory taking injected `db` and `refresher`, so tests run against fakes (`docs/ARCHITECTURE.md:61`).
- Satellites are unique by NORAD id with the newest TLE winning; group membership is a separate table so one satellite can belong to many groups.
- Every statement is parameterised, and LIKE input is escaped in `db.ts`, never in route code. `q` is bounded to 2–64 characters — an unbounded pattern is a cheap CPU DoS.
- Stale-while-revalidate: a request waits on CelesTrak only when the group is completely empty; with any cached data it serves stale immediately and refreshes in the background, swallowing the failure.
- Concurrent refreshes of one group share a single in-flight promise, and a failed group sits out `failureCooldownMs` before it is retried.
- A refresh that parses zero records throws rather than replacing the group with nothing.
- The seed keeps its own `fetchedAt` as `updated_at`, so seeded groups count as stale and refresh on first use.
- `parseTleText` skips malformed entries and never throws; both lines must be 69 chars and agree on the catalog number.
- The parser handles Alpha-5 catalog numbers (leading letter = 10..33, with I and O unused).

## Traps
- `AGENTS.md:90` — `apps/api/data/` is gitignored and generated; the committed truth is `apps/api/seed/`. Regenerate it with `npm run seed:make -w apps/api`, never hand-edit it.
- `AGENTS.md:94` — `apps/api` runs TypeScript directly under Node and its `build` is `tsc --noEmit`, so a type error appears in `npm run build`, not in `npm run dev`.

## How to test
`npm test -w apps/api -- refresh` (also `-- db`, `-- celestrak`, `-- seed`, `-- app`). Vitest against in-memory SQLite with an injected fake fetcher and clock — no network, no Docker, no running API.
