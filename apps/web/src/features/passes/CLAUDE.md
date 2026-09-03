## Owns
Pass prediction for one observer: the observer store (persisted), the 24 h prediction panel with its observer editor, and the polar az/el sky plot — the design's signature widget.

## Depends on
`lib/orbital` (`createSatrec`, `predictPasses`), `lib/protocol` (`ObserverGeo`, `PassPrediction`), `core/sim/simClock` (the prediction window is anchored at SIM time, not wall time), and `features/catalog/catalogStore` for the selected satellite — the cross-slice read `docs/ARCHITECTURE.md:33` permits.

## Invariants
- Prediction runs on the main thread here, through `lib/orbital.predictPasses`; the worker's `passes` job is the same pure function, so the two must never diverge.
- `setResults` is ignored unless `computedFor` still matches the satellite it was started for — a slower earlier prediction may not overwrite a newer one.
- Changing the observer clears `passes`, `computedFor` and `windowStartMs` together; stale predictions for a moved observer are never shown.
- `windowExpired` is the only thing that recomputes on time: sim time warped or scrubbed outside `[windowStartMs, +24 h]` invalidates the window.
- `computedFor` is read via `getState()`, deliberately out of the effect deps, so `startCompute()` cannot retrigger the effect and cancel its own timer (`PassesPanel.tsx:39`).
- A stored observer is re-validated on load (finite, |lat| ≤ 90, |lon| ≤ 180); corrupt or unavailable `localStorage` falls back to the default rather than throwing.
- `SkyPlot` projects `r = (90 − el)/90 · R` with north up and east right, and drops samples below the horizon.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- passesStore` (vitest), plus `-- orbital` for the prediction math itself — `lib/orbital.test.ts` pins it against a fixed ISS TLE fixture, which is the only thing standing between a frame/unit change and a plausible wrong answer. No API, no Docker.
