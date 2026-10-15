## Owns
Whole-catalog SGP4 off the main thread. `propagationDispatcher.ts` is the logic — the satrec working set and the `init`/`tick` handlers, free of the worker global so it is testable; `propagation.worker.ts` only binds it to `self`. Selected-satellite math (ring, ground track, live state) and pass prediction run on the MAIN thread through `lib/orbital`, not here.

## Depends on
`lib/orbital` (`createSatrec`, `classifyOrbit`, `propagateBatchEcefM`), `lib/protocol` for `SatInit`/`WorkerRequest`/`WorkerResponse`/`ORBIT_CLASSES`, and `satellite.js` for `SatRec`. `app/GlobeView` spawns the worker, sends `init`/`tick` and is the only consumer of `ready`/`positions`/`error`. A risk path in `.claude/kit.profile.yaml`.

## Invariants
- The `init` array order IS the protocol: the working set, `noradIds`, `classes` and every `positions` Float32Array share that index, and `ready` echoes it back. Re-ordering the catalog without re-initing silently mis-places and mis-colours everything.
- A TLE that fails to parse is kept as `null` in the working set, never dropped — dropping it would shift every later index.
- An unpropagatable satellite (null satrec or SGP4 failure) emits a NaN position triple, never (0,0,0); consumers must hide on NaN.
- Class bytes index `ORBIT_CLASSES`; that array is the authority on both sides.
- Positions are ECEF **metres** in a `Float32Array`, transferred (not copied) — the buffer is detached after `post`, so it must never be read again on this side. One GMST per tick serves the whole batch.
- An unknown request type, or a handler that throws, is answered with an `error` response — the worker never dies quietly.
- All math lives in `lib/orbital`; the dispatcher only dispatches.

## Traps
- `AGENTS.md:94` — nothing in the repo is named "sgp4". The profile's earlier `**/*sgp4*` risk-path glob matched no file at all, so the propagator was ungated; it lives here and under `**/*propagat*`.
- `CLAUDE.md` → *Verification* — a green `npm run lint && npm test` cannot see a frame or unit error here: the output is plausible and wrong. Positions are checked by running it and watching, and by the pinned-fixture tests below.

## How to test
`npm test -w apps/web -- propagationDispatcher` pins the index protocol (garbage and decayed TLEs keep their slots as NaN triples, transfer list, unknown type and throwing handler → `error`) against the fixed ISS TLE fixture; `-- orbital` pins the math (`propagateBatchEcefM` bit-exact against `propagateEcef`, the ECEF conversion bit-exact against `satellite.js` `eciToEcf`). No API, no Docker.
