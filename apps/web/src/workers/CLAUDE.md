## Owns
`propagation.worker.ts` — the SGP4 batch propagator. A thin dispatcher over `lib/orbital` that owns the satrec working set and keeps all heavy math off the main thread.

## Depends on
`lib/orbital` (`createSatrec`, `classifyOrbit`, `propagateEcef`, `sampleOrbitTrack`, `predictPasses`), `lib/protocol` for `WorkerRequest`/`WorkerResponse`/`ORBIT_CLASSES`, and `satellite.js` for `SatRec`. Spawned and driven by `app/GlobeView`; `features/constellation` consumes `positions`, `features/tracking` consumes `track`. A risk path in `.claude/kit.profile.yaml`.

## Invariants
- The `init` array order IS the protocol: `satrecs`, `noradIds`, `classes` and every `positions` Float32Array share that index, and `ready` echoes it back. Re-ordering the catalog without re-initing silently mis-places and mis-colours everything.
- A TLE that fails to parse is kept as `null` in the working set, never dropped — dropping it would shift every later index.
- An unpropagatable satellite emits a NaN position triple, never (0,0,0); consumers must hide on NaN.
- Class bytes index `ORBIT_CLASSES`; that array is the authority on both sides.
- Positions are ECEF **metres** in a `Float32Array`, transferred (not copied) — the buffer is detached after `post`, so it must never be read again on this side.
- `track` and `passes` answer with an `error` message when the norad id has no usable satrec; the worker never silently returns an empty result.
- `onmessage` wraps every handler in try/catch and posts an `error` response — a throwing worker must not die quietly.
- All math lives in `lib/orbital`; this file dispatches and must stay a dispatcher.

## Traps
- `AGENTS.md:92` — nothing in the repo is named "sgp4". The profile's earlier `**/*sgp4*` risk-path glob matched no file at all, so the propagator was ungated; it lives here and under `**/*propagat*`.
- `CLAUDE.md` → *Verification* — a green `npm run lint && npm test` cannot see a frame or unit error here: the output is plausible and wrong. Positions are checked by running it and watching, and by the pinned-fixture tests below.

## How to test
The dispatcher has no test of its own; its math does — `npm test -w apps/web -- orbital`, which pins `lib/orbital` against a fixed ISS TLE fixture (known period, inclination bound and physical state at epoch). `npm test -w apps/web` for the workspace. No API, no Docker.
