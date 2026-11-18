## Owns
Pass prediction for one observer: the observer store (persisted via `lib/storage`, validated by `observer`), the next-pass panel (countdown, direction, naked-eye flag, WATCH, folded observer line) over a 24 h prediction window, and the polar az/el sky plot — the design's signature widget.

## Depends on
`lib/orbital` (`createSatrec`, `predictPasses`), `lib/protocol` (`ObserverGeo`, `PassPrediction`), `lib/format` (countdown, compass, UTC HH:MM), `core/sim/simClock` (the prediction window is anchored at SIM time, not wall time), and `core/ui/satelliteStore` for the selected satellite.

## Invariants
- Prediction runs on the main thread, deferred off the click by a `setTimeout`, through `lib/orbital.predictPasses` — the only pass predictor; the worker has no passes job.
- `setResults` is ignored unless `computedFor` still matches the satellite it was started for — a slower earlier prediction may not overwrite a newer one.
- Changing the observer clears `passes`, `computedFor` and `windowStartMs` together; stale predictions for a moved observer are never shown.
- `windowExpired` is the only thing that recomputes on time: sim time warped or scrubbed outside `[windowStartMs, +24 h]` invalidates the window.
- `passView` (`passView.ts`) alone decides the next pass, the shown pass and the countdown; a picked pass that ended falls back to the next; pass times are UTC, labelled. While `busy` the panel reads no `passes` at all (`startCompute` leaves the old ones in place).
- `computedFor` is read via `getState()`, deliberately out of the effect deps, so `startCompute()` cannot retrigger the effect and cancel its own timer (`PassesPanel.tsx:50`).
- A stored observer is re-validated on load (finite, |lat| ≤ 90, |lon| ≤ 180); corrupt or unavailable `localStorage` falls back to the default rather than throwing.
- `skyProjection` (drawn by `SkyPlot`) projects `r = (90 − el)/90 · R` with north up and east right, and drops samples below the horizon.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- passView`, `npm test -w apps/web -- passesStore`, `-- observer` and `-- skyProjection` (vitest), plus `-- orbital` for the prediction math itself — `lib/orbital.test.ts` pins it against a fixed ISS TLE fixture, which is the only thing standing between a frame/unit change and a plausible wrong answer. No API, no Docker.
