## Owns
Group loading — curated groups, which groups are active, the merged working set sent to the propagation worker, the per-group cache — and the catalog panel (group toggles + search) that drives it. Satellite entities (`byId`) and the selection are not here: they live in `core/ui/satelliteStore`.

## Depends on
`GET /api/groups`, `/api/satellites?group=`, `/api/satellites/search` through `lib/api`; `GroupInfo`/`Satellite` from `@orbital-ops/shared`; `core/ui/satelliteStore`, which it writes (`upsertSats` for every new working set, `registerSat` + `select` for a search pick). `app/globe/constellationFeed` reads `sats` to (re)init the worker.

## Invariants
- No sibling slice imports this one and it imports none (`docs/ARCHITECTURE.md:33`); what `tracking` and `passes` need — entities and the selection — is in `core/ui/satelliteStore`.
- Every new working set goes into `satelliteStore.byId` (`upsertSats`) BEFORE `sats` is set, so each id the worker is about to be fed already resolves in `byId` whenever a subscriber of either store looks.
- `sats` is the worker's working set and its order is the worker's index order — `ready` returns `noradIds` and `classes` in exactly that order, so a reorder silently mis-colours and mis-positions everything.
- `mergeActive` dedupes by `noradId`, first active group wins, and `upsertSats` makes that record the one `byId` holds; `byId` itself never drops an id (working set ∪ search hits), so a selected satellite whose group goes off stays resolvable and selected.
- `groupCache` is module-scope, so toggling a group off and on again never refetches.
- `starlink` (10k+ objects) is the one group off by default.
- `init` uses `Promise.allSettled` and keeps only the groups that actually loaded; a total failure sets `offline` and clears `booting` rather than hanging on the boot overlay.
- `satelliteStore.registerSat` (first registration wins) is what makes a search hit selectable while its group is inactive; the panel calls it before `select`.
- A failed `api.search` shows SEARCH UNAVAILABLE in the dropdown (`CatalogPanel.tsx` `failed`), never an empty list that reads as "no matches"; only the latest request (`searchSeq`) may set it.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- catalogStore` (vitest; also pins byId-before-sats and the toggle-off selection) and `-- satelliteStore` for the entity/selection store. No API, no Docker — `lib/api` is mocked. The API side of the same contract is `npm test -w apps/api -- app` / `-- db`.
