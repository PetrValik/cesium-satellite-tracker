## Owns
The satellite entity and selection store — curated groups, which groups are active, the merged working set sent to the propagation worker, search registration — and the catalog panel that drives it.

## Depends on
`GET /api/groups`, `/api/satellites?group=`, `/api/satellites/search` through `lib/api`; `GroupInfo`/`Satellite` from `@orbital-ops/shared`. `app/GlobeView` reads `sats` to (re)init the worker and `selectedId` to drive tracking.

## Invariants
- `catalogStore` is the one exception to the no-cross-slice-import rule (`docs/ARCHITECTURE.md:33`): `tracking`, `passes` and `constellation` may read it, because it is the satellite domain's entity/selection store. Nothing else may, and this slice imports no sibling.
- `sats` is the worker's working set and its order is the worker's index order — `ready` returns `noradIds` and `classes` in exactly that order, so a reorder silently mis-colours and mis-positions everything.
- `byId` is append-only across the session (working set ∪ search hits); `mergeActive` dedupes by `noradId`, first active group wins.
- `groupCache` is module-scope, so toggling a group off and on again never refetches.
- `starlink` (10k+ objects) is the one group off by default.
- `init` uses `Promise.allSettled` and keeps only the groups that actually loaded; a total failure sets `offline` and clears `booting` rather than hanging on the boot overlay.
- `registerSat` is what makes a search hit selectable while its group is inactive.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- catalogStore` (vitest). No API, no Docker — `lib/api` is mocked. The API side of the same contract is `npm test -w apps/api -- app` / `-- db`.
