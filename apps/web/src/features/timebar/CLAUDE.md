## Owns
The transport bar: play/pause, the warp-rate buttons, a ±12 h scrub against wall-now, the NOW reset and the UTC readout. UI only — it holds no time state of its own.

## Depends on
`core/sim/simClock` (the single source of truth for `epochMs`, `rate`, `playing`, plus `stepRate`), `lib/wallClock` for "now", and `lib/format` (`formatRate`, `formatUtc`). Rendered by `app/`; no slice imports from here, and this slice imports no sibling.

## Invariants
- `core/sim/simClock` owns sim time; this bar only calls its actions. Nothing here may set `epochMs` directly, and the sync to Cesium is one-way (`core/engine/createViewer.syncViewerClock`).
- The scrub slider keeps a transient local value **only while dragging** and must reset on pointer/key release, or it freezes at a stale offset.
- The rate buttons offer exactly `SIM_RATES` from the store — the list lives there, never duplicated here; the compact − / + stepper walks it through `stepRate`, the same walk as the `,` / `.` keys.
- The slider position is `scrub.ts` `scrubSliderValue`: the drag value while dragging, else the sim offset clamped to ±12 h.
- Scrubbing and NOW are discontinuous jumps: the store bumps `jumpNonce`, because an epoch delta cannot tell a jump from one high-warp frame. Anything reacting to jumps watches that, not the delta.
- The readout is UTC; sim time is never rendered in local time.

## Traps
None recorded yet; add the first incident here.

## How to test
`npm test -w apps/web -- scrub` (offset and slider clamp, `scrub.test.ts`). The state machine and the rate walk are tested one level up: `-- simClock` (and `-- format` for the readout). No API, no Docker.
