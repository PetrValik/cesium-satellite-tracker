# HUD round: navigation, multi-domain legend, palette, time bar, satellite detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone, the owner can type a hex colour, read a legend whose colours mean the same thing in every domain, get back to the whole Earth (or level a tilted view) in one tap, reach the legend of every domain that is on, see the time bar only while it does something, and read a satellite's detail at a glance.

**Architecture:** Five parts, each built from small pure rules in `core/ui` / `lib` (unit-tested in plain node) plus thin React and CSS on top (run-checked). Camera operations live in `core/engine/CameraRig`. The HUD reaches them through a non-React command store (`core/ui/cameraStore`), which `app/globe` forwards to the rig, the same shape as `followStore` → `GlobeFollow`. Orbit, sun and pass maths stay in `lib/orbital` and run once per selection or at the 5 Hz telemetry push, never per frame.

**Tech Stack:** React 19, zustand, CesiumJS 1.138, satellite.js 6.0.2, Vite, vitest (node environment: no jsdom, no Testing Library), TypeScript `tsc -b` in CI.

**Spec:** `docs/superpowers/specs/2026-11-18-hud-nav-legend-palette-design.md`

## Global Constraints

- Cesium machinery stays in `apps/web/src/core/engine/` (non-React); every create has a destroy; per-frame code allocates nothing.
- No cross-slice imports (`docs/ARCHITECTURE.md`). Slices meet in `app/`; shared state lives in `core/`.
- `npm run lint && npm test` green from the repo root after every task. CI also runs `npm run build` (`tsc -b`), so run `npx tsc -b apps/web` after any type change.
- TypeScript: React 19 types have no global `JSX` namespace (leave component return types unannotated); `lib` is ES2022 (no `Array.prototype.findLast`).
- Touch targets ≥ 44 px, safe-area insets respected, HUD visual language.
- Amber `#ffb454` is the selection signal only, never a default. Meaning → hue is fixed: military red `#f87171`, civil/passenger blue `#4da6ff`, cargo green `#7dd87d`, tanker violet `#c084fc`, fishing teal `#2dd4bf`, high-speed hot pink `#ff5f8f`, other grey `#8a93a3`; satellites LEO `#a8f0ff`, MEO `#a3e635`, GEO `#ffd166`, HEO `#ffa1b5`. `@hud-designer` may adjust shades, not the hues.
- Swatch grid: ≤ 8 columns, swatches ≥ 32 px, one light → dark ramp per column, every default present.
- HOME = lon 15°, lat 35°, 28 000 km, north-up. LOCATE ≈ 500 km above the device. Compass heading is published only on a change of ≥ 1°.
- Time bar rule: `ORBITAL layer on && (a satellite is selected || sim time is not live)`.
- Times in the HUD are UTC and labelled as UTC. Data age is measured against sim time.
- Artefacts in English. Commits: `<type>(<scope>): <summary>`, ≤ 70 chars, imperative, lowercase after the colon, no trailing period, **no AI co-author trailer**.

## Execution rules (every task)

- **Order:** Part 4 → 3 → 1 → 2 → 5, then Task 6.1. The parts edit some of the same files (`App.tsx`, `CompactHud.tsx`, `globeKeys.ts`, `HelpOverlay.tsx`, `docs/CONTROLS.md`, `styles/index.css`, `docs/ARCHITECTURE.md`, `AGENTS.md`). Each part's text says what the earlier ones left. Line numbers are from `main` at `665fa7b` and move as earlier parts land, so anchor every edit on the content.
- **Skills:** load `frontend-slice-architecture` before the first write under `apps/web/src/features/**`, `frontend-testing` before writing a slice test, `writing-instructions` before editing any `CLAUDE.md` or `AGENTS.md`, and `conventions` before the first commit.
- **Specialists** (repo `CLAUDE.md`; all on `opus`): `@cesium-engine` for `CameraRig`, `createViewer` and the frame loop's camera read (Tasks 2.2–2.4, 2.8); `@hud-designer` for CSS and layout (Tasks 1.2, 1.3, 2.7, 3.4, 5.6, 5.7); `@orbital-mechanics` for `lib/orbital`, `predictPasses` and the telemetry push (Tasks 5.1–5.3, 5.5).
- **Risk paths:** `apps/web/src/core/engine/**` (Tasks 2.2, 2.3 and possibly 2.8 Step 5). Ask the owner before the edit, at edit time.
- **Bound:** when the same gate fails three times, stop and report. Never `--no-verify`.
- `.claude/.headroom_wrap_settings.lock` is not ours: never stage it.

## Review Focus

1. **Time bar flash after a tab or app switch** with nothing picked: the bar, `SIM ×1` and `.has-transport` must not show for the 10 s until the next wall tick. Pinned by `timing.test.ts` "re-reads the wall clock after a background gap of 10 s or more" (Task 4.2), plus run check 10.
2. **Follow lock fighting navigation**: the camera snaps back after HOME / LOCATE, or the lock cuts a flight short. Pinned by `cameraCommands.test.ts` "HOME releases the lock before it flies" and "locate (flyTo) releases the lock before it flies", and by `CameraRig.test.ts` "a flight drops a pending zoom step and a follow lock" (Tasks 2.3, 2.4). The `update()` re-adopt path has no unit test; Task 2.8 Step 2 run-checks it.
3. **Colour migration overwrites a pick, or re-migrates it on reload.** Pinned by `prefsStore.test.ts` "keeps every colour the user picked, including another key's v1 default", "stamps paletteVersion 2 on every write…" and "reads v2 prefs unchanged and writes nothing at load" (Task 1.1).
4. **Satellite detail shows contradictory or stale facts**: NOW altitude outside the ORBIT span (pinned by `orbital.test.ts` "spans the geodetic altitude NOW shows over one orbit", Task 5.1); the previous satellite's countdown while COMPUTING (the `busy` guard in Task 5.7, run-checked in Task 6.1 Step 2); a wrong SUNLIT flag (pinned by `orbital.crosscheck.test.ts` against Cesium's occluder, Task 5.2, and `SelectedSatellite.test.ts` "pushes sunlit with the 5 Hz readout…", Task 5.5).
5. **Stacked legend**: a render loop from a fresh-array selector, or a CATALOG search pick under MARITIME focus whose details never appear. Pinned by `railPicture.test.ts` "hands out the same entry objects every call (useShallow relies on it)" and `searchPick.test.ts` "registers and focuses before it selects, like a globe tap" (Tasks 3.1, 3.3). Nothing in the suite can pin the hex field closing under the phone keyboard; the grep check in Task 1.2 and the owner's on-device check cover it.

## Calls made while planning (added to the spec; the owner checks them in the PR)

- **15. ORBIT span = geodetic low–high over one orbit**, not mean-element perigee/apogee, so the NOW altitude never reads above the "highest point" (ISS: 419.8–433.0 km vs 415.7–424.8 km). Perigee/apogee stay in the span's title.
- **16. Own Sun model instead of `satellite.js` `sunPos`**: 6.0.2 applies `deg2rad` to the rate term only (`node_modules/satellite.js/lib/sun.js:45`), which is 1.40° off and puts the ISS in shadow on 22 of 558 samples of an orbit Cesium shows fully sunlit. A canary test flags the day an upgrade fixes it.
- **10 (revised). Desktop nav placement**: a column under the mode tabs, at the right edge while the right stack is empty and beside it while panels show. The bottom-right row from call 10 overlaps the right stack from 900 to 1419 px wide with the bar mounted. Phones keep a column (portrait) or a row heading the cluster (landscape).

---

## Part 4: Time bar only with a satellite picked

Today the transport bar, the status-line SIM readout, the time keys and `.has-transport` all show whenever the ORBITAL layer is on (`core/ui/modeStore.ts:95-97`). After this part they follow one rule in a new `core/ui/transport.ts`: **ORBITAL layer on && (a satellite is selected || sim time is not live)**. The NOW reset in `layerSync` still fires when ORBITAL turns off, and `modeStore.transportVisible` is removed. No risk-path file is touched (nothing under `core/engine`, `workers` or `*propagat*`).

### Task 4.1: The rule module `core/ui/transport.ts`

**Files:**
- Create: `apps/web/src/core/ui/transport.ts`
- Test: `apps/web/src/core/ui/transport.test.ts`

**Interfaces:**
- Consumes: `useMode` (`satellitesVisible`) from `core/ui/modeStore.ts`; `useSatellites` (`selectedId`) from `core/ui/satelliteStore.ts`; `isSimLive(state, nowMs = Date.now())`, `simClock`, `LIVE_EPSILON_MS` from `core/sim/simClock.ts:62-87`; `useSimLive(): boolean` from `core/sim/simLive.ts:19`.
- Produces:
  - `transportVisibleFor(input: { satellitesVisible: boolean; satelliteSelected: boolean; simLive: boolean }): boolean`, the pure rule.
  - `transportVisibleNow(): boolean`, the non-reactive twin for keys and wiring. It reads `Date.now()`, so it must never be called during render.
  - `useTransportVisible(): boolean`, the React hook.

- [ ] **Step 1: Write the failing test** `apps/web/src/core/ui/transport.test.ts`
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LIVE_EPSILON_MS, useSimClock } from '../sim/simClock'
import { useMode } from './modeStore'
import { useSatellites } from './satelliteStore'
import { transportVisibleFor, transportVisibleNow } from './transport'

const ISS = 25_544

describe('transportVisibleFor', () => {
  it('hides whenever the ORBITAL layer is off', () => {
    for (const satelliteSelected of [true, false])
      for (const simLive of [true, false])
        expect(transportVisibleFor({ satellitesVisible: false, satelliteSelected, simLive })).toBe(false)
  })
  it('shows with a satellite picked, at NOW or off it', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: true, simLive: true })).toBe(true)
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: true, simLive: false })).toBe(true)
  })
  it('hides on the boot screen: ORBITAL on, nothing picked, sim live', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: false, simLive: true })).toBe(false)
  })
  it('stays after a deselect while sim time is off NOW (the way back to NOW)', () => {
    expect(transportVisibleFor({ satellitesVisible: true, satelliteSelected: false, simLive: false })).toBe(true)
  })
})

describe('transportVisibleNow', () => {
  beforeEach(() => {
    useMode.setState({ satellitesVisible: true })
    useSatellites.setState({ selectedId: null })
    useSimClock.setState({ epochMs: Date.now(), rate: 1, playing: true })
  })
  it('reads the ORBITAL layer and the satellite selection', () => {
    expect(transportVisibleNow()).toBe(false)
    useSatellites.getState().select(ISS)
    expect(transportVisibleNow()).toBe(true)
    useMode.setState({ satellitesVisible: false })
    expect(transportVisibleNow()).toBe(false)
  })
  it('counts warped, paused and scrubbed-off-NOW sim time as not live', () => {
    const clock = useSimClock.getState()
    clock.setRate(60)
    expect(transportVisibleNow()).toBe(true)
    clock.resetToNow()
    expect(transportVisibleNow()).toBe(false)
    clock.togglePlay() // paused at ×1
    expect(transportVisibleNow()).toBe(true)
    clock.scrubTo(Date.now() - 2 * LIVE_EPSILON_MS)
    clock.play() // playing ×1 but 20 s behind wall time
    expect(transportVisibleNow()).toBe(true)
    useSimClock.setState({ epochMs: Date.now() - LIVE_EPSILON_MS / 2 })
    expect(transportVisibleNow()).toBe(false)
  })
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- transport`. It fails to resolve `./transport` (the module does not exist yet).
- [ ] **Step 3: Implement the three exports in `apps/web/src/core/ui/transport.ts`**:
  - `transportVisibleFor` is `satellitesVisible && (satelliteSelected || !simLive)`.
  - `transportVisibleNow` feeds it `useMode.getState().satellitesVisible`, `useSatellites.getState().selectedId !== null` and `isSimLive(simClock.get())`.
  - `useTransportVisible` feeds it `useMode((s) => s.satellitesVisible)`, `useSatellites((s) => s.selectedId !== null)` and `useSimLive()`.
  - The module doc comment takes over the "why" from `modeStore.ts:90-94`: warp only moves satellites, and the not-live clause keeps NOW on screen after a deselect while warped. It also says this is the one place the rule is written.
  - Do not touch `modeStore.transportVisible` yet. Task 4.3 removes it.
  - The hook gets no unit test, because vitest here runs in plain node with no DOM. Task 4.2's run check covers it.
- [ ] **Step 4: Run it, expect PASS**. `npm test -w apps/web -- transport` passes, then `npm run lint && npm test` from the root is green.
- [ ] **Step 5: Commit**: `git add apps/web/src/core/ui/transport.ts apps/web/src/core/ui/transport.test.ts` then `git commit -m "feat(web): add the time bar visibility rule to core/ui"`

### Task 4.2: Everything that travels with the bar follows the rule

**Files:**
- Modify: `apps/web/src/app/globe/globeKeys.ts:6,19-27`
- Modify: `apps/web/src/App.tsx:20,33`
- Modify: `apps/web/src/app/CompactHud.tsx:2,71`
- Modify: `apps/web/src/app/StatusLine.tsx:7,17`
- Modify: `apps/web/src/styles/transport.css:174-175` (comment only)
- Modify: `apps/web/src/app/HelpOverlay.tsx:20,48-50`
- Modify: `docs/CONTROLS.md:58-60,143-157`
- Modify: `apps/web/src/features/timebar/CLAUDE.md:5,7-13`
- Test: `apps/web/src/app/globe/globeKeys.test.ts:6-12,33-47` (setup) plus one new `it`

**Interfaces:**
- Consumes: `transportVisibleNow()` and `useTransportVisible()` from Task 4.1.
- Produces: `timeControlsActive(): boolean`, same signature, now `transportVisibleNow() && !useHud.getState().hidden`. The `.app-root.has-transport` class now means "the bar is mounted under the new rule", and Part 2's nav placement can rely on it.

- [ ] **Step 1: Write the failing test** in `globeKeys.test.ts`:
  - Import `useSatellites` from `'../../core/ui/satelliteStore'`.
  - In `beforeEach`, add `useSatellites.setState({ selectedId: 25_544 })`.
  - Change the clock reset to `useSimClock.setState({ rate: 1, playing: true, epochMs: Date.now() })`. This keeps the bar "shown" for the existing time-key tests, which stay unchanged.
  - Add:
```ts
it('time keys follow the time bar: quiet at NOW with nothing picked, on with a pick or off NOW', () => {
  const { onKeyDown } = setup()
  useSatellites.setState({ selectedId: null })
  expect(timeControlsActive()).toBe(false)
  onKeyDown(key('Period'))
  expect(useSimClock.getState().rate).toBe(1)
  const space = key('Space')
  onKeyDown(space)
  expect(useSimClock.getState().playing).toBe(true)
  expect(space.preventDefault).not.toHaveBeenCalled()

  useSatellites.setState({ selectedId: 25_544 })
  onKeyDown(key('Period'))
  expect(useSimClock.getState().rate).toBe(10)

  // Deselect while warped: the bar stays, so N still brings time back.
  useSatellites.setState({ selectedId: null })
  expect(timeControlsActive()).toBe(true)
  onKeyDown(key('KeyN'))
  expect(useSimClock.getState()).toMatchObject({ rate: 1, playing: true })
  expect(timeControlsActive()).toBe(false)
})
```
  - Append to `apps/web/src/app/globe/timing.test.ts` (import `needsWallResync` from `./frameLoop`, `LIVE_EPSILON_MS` from `../../core/sim/simClock`):
```ts
it('re-reads the wall clock after a background gap of 10 s or more', () => {
  expect(needsWallResync(LIVE_EPSILON_MS - 1)).toBe(false)
  expect(needsWallResync(LIVE_EPSILON_MS)).toBe(true)
  expect(needsWallResync(30_000)).toBe(true)
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- globeKeys`. The new test fails at its first assertion with `expected true to be false`, because the old rule ignores the selection. The timing test fails with `needsWallResync is not a function`.
- [ ] **Step 3: Implement**
  - `globeKeys.ts`:
    - Import `transportVisibleNow` from `'../../core/ui/transport'`.
    - Drop `transportVisible` from the modeStore import but keep `useMode`, which is still used.
    - The body of `timeControlsActive` becomes `transportVisibleNow() && !useHud.getState().hidden`.
    - Rewrite the doc comment at :19-24: the time controls hide with the bar under `core/ui/transport`'s rule (the bar is unmounted) and with the HUD (the bar is faded out and inert). Keep the "invisible warp would silently suspend the live feeds" reason.
  - `App.tsx:33`, `CompactHud.tsx:71` and `StatusLine.tsx:17`: replace `useMode(transportVisible)` with `useTransportVisible()`. In each of these three files, `useMode` was imported only for that call (checked), so replace the modeStore import line (`App.tsx:20`, `CompactHud.tsx:2`, `StatusLine.tsx:7`) with `import { useTransportVisible } from '…/core/ui/transport'`. Otherwise tsc's `noUnusedLocals` fails.
  - `styles/transport.css:174-175` comment: "App sets .has-transport with the ORBITAL layer" becomes "App sets .has-transport from core/ui/transport (ORBITAL on and a satellite picked, or sim time off NOW)".
  - `HelpOverlay.tsx`:
    - Line 20 becomes `['▶ ❚❚ · − + · NOW', 'Time bar (with a satellite picked): play / pause, slower / faster warp, reset to NOW']`.
    - Lines 48-50 become `['SPACE', 'Play / pause simulation time (time bar shown)']`, `[', / .', 'Slower / faster time warp (time bar shown)']` and `['N', 'Reset simulation to NOW (time bar shown)']`.
    - Leave the CAMERA section alone; Part 2 adds `0` / `R` there.
  - `docs/CONTROLS.md`:
    - Rows 58-60: the suffixes "(ORBITAL layer on)" become "(while the time bar shows)", and N gets the same suffix.
    - Under "Simulation time (transport bar)", after the paragraph ending at :146, insert: "The bar shows while the SATELLITES layer is on **and** a satellite is selected. It also stays while sim time is away from NOW (warped, paused or scrubbed), so a deselect never hides the way back; once sim time is at NOW with nothing selected, it hides. Turning SATELLITES off while away from NOW resets sim time to NOW. The time keys and the status line's SIM readout come and go with the bar."
    - Lines 156-157 become: "…tracked-object count, TLE data age, and, while the bar shows, the current SIM rate (or HOLD when paused)."
  - `features/timebar/CLAUDE.md`. Load `frontend-slice-architecture` (the skill-routing hook asks for it on the first `features/**` write) and `writing-instructions` before editing.
    - Line 5: "Rendered by `app/`" becomes "Rendered by `app/` only while `core/ui/transport` `useTransportVisible()` holds".
    - Add an Invariants bullet: "- When the bar shows is one rule, `core/ui/transport` `transportVisibleFor`: ORBITAL layer on and (a satellite selected, or sim time not live). `.has-transport`, the status-line SIM readout and the time keys (`app/globe/globeKeys.ts` `timeControlsActive`) use it too. Off NOW, the bar hides only when ORBITAL turns off, and that resets to NOW (`app/globe/layerSync.ts`). Owner's call 2026-11-18: the bar showed on the boot screen, where warp does nothing."
    - The file stays under 25 lines.
  - `app/globe/frameLoop.ts` (tab-return flash; without it the bar, `SIM ×1` and `.has-transport` show for up to 10 s after a tab or app switch with nothing picked, because the stopped rAF never advanced the epoch and `useSimLive` re-checks only on the 10 s wall tick):
    - Export `needsWallResync(rawDtMs: number): boolean`, true when `rawDtMs >= LIVE_EPSILON_MS` (import `LIVE_EPSILON_MS` from `core/sim/simClock` and `useWallClock` from `core/sim/wallClock`).
    - In `frame()`: `const rawDt = now - lastFrame; const dt = frameAdvanceMs(rawDt, simClock.get().rate)`, and right after `simClock.get().advance(dt)` add `if (needsWallResync(rawDt)) useWallClock.setState({ nowMs: Date.now() })`.
- [ ] **Step 4: Run it, expect PASS**. `npm test -w apps/web -- globeKeys` passes, then `npm run lint && npm test` from the root is green. Then do the run check: `npm run dev`, then open `http://localhost:5173` in a private window, which gives the boot defaults (ORBITAL only, nothing selected).
  1. Desktop 1280×800, nothing selected:
     - There is no transport bar, and the status line has no `SIM ×1`.
     - In DevTools Elements, `.app-root` has no `has-transport`, and HELP / COLORS / HIDE sit at the bottom edge.
     - `.` and SPACE change nothing.
  2. Click a satellite. The bar appears bottom-centre, `SIM ×1` appears, `has-transport` is set, and the launchers lift above the bar.
  3. Press `.` twice (`SIM ×60`), then click empty globe. The telemetry closes, but the bar and `SIM ×60` stay. Click NOW, and the bar, the readout and the class all go.
  4. Select a satellite, press `.`, then press `1` (SATELLITES off). The bar goes. Press `2`: the VESSELS row does not read SUSP, because time is back at NOW.
  5. Select a satellite, turn VESSELS on from LAYERS and click a ship. Focus moves to MARITIME and the bar stays, because the satellite is still selected.
  6. With the bar shown, press U. The bar fades with the HUD and `.` does nothing. Press U again and the bar is back.
  7. Press H. The LAYERS & TIME rows read "(time bar shown)".
  8. In the DevTools device toolbar, try Pixel 7 (412×915) and its landscape. Repeat 1–3: the bar joins the bottom cluster under the dock, and the chip and dock move up without overlap.
  9. The console has no errors.
  10. With nothing selected, switch to another tab for 30 s and come back: no bar, no `SIM` readout and no `.has-transport` (at most one frame).
- [ ] **Step 5: Commit**: `git add apps/web/src/app/globe/globeKeys.ts apps/web/src/app/globe/globeKeys.test.ts apps/web/src/App.tsx apps/web/src/app/CompactHud.tsx apps/web/src/app/StatusLine.tsx apps/web/src/styles/transport.css apps/web/src/app/HelpOverlay.tsx docs/CONTROLS.md apps/web/src/features/timebar/CLAUDE.md apps/web/src/app/globe/frameLoop.ts apps/web/src/app/globe/timing.test.ts` then `git commit -m "feat(web): show the time bar only with a satellite picked"`

### Task 4.3: NOW reset tied to ORBITAL off; retire `modeStore.transportVisible`

**Files:**
- Modify: `apps/web/src/app/globe/layerSync.ts:4,114-119`
- Modify: `apps/web/src/core/ui/modeStore.ts:90-97`
- Modify: `apps/web/src/core/ui/modeStore.test.ts:21-22,241-249`
- Test: `apps/web/src/app/globe/follow.test.ts`, describe `'LayerSync satellite selection'` (:192-257)

**Interfaces:**
- Consumes: `isDomainVisible(s, 'orbital')` (modeStore.ts:86), `isSimLive` and `simClock` (already imported in layerSync.ts:3), and `transportVisibleNow()` (Task 4.1, tests only).
- Produces: nothing new. `transportVisible` is gone from `core/ui/modeStore`.

- [ ] **Step 1: Write the pin tests** in `follow.test.ts`:
  - Import `isSimLive, useSimClock` from `'../../core/sim/simClock'` and `transportVisibleNow` from `'../../core/ui/transport'`.
  - In the `'LayerSync satellite selection'` describe's `beforeEach`, add `useSimClock.setState({ epochMs: Date.now(), rate: 1, playing: true })`.
  - Add to that describe:
```ts
it('hiding SATELLITES while warped snaps sim time back to NOW', () => {
  mount()
  useSimClock.getState().setRate(60)
  useMode.getState().toggleLayer('orbital')
  expect(useSimClock.getState()).toMatchObject({ rate: 1, playing: true })
  expect(isSimLive(useSimClock.getState())).toBe(true)
})
it('hiding SATELLITES at NOW does not jump the clock', () => {
  mount()
  const { jumpNonce } = useSimClock.getState()
  useMode.getState().toggleLayer('orbital')
  expect(useSimClock.getState().jumpNonce).toBe(jumpNonce)
})
it('a deselect while warped keeps sim time off NOW and the bar up', () => {
  mount()
  useSatellites.getState().registerSat(HIT)
  useSatellites.getState().select(HIT.noradId)
  useSimClock.getState().setRate(60)
  useSatellites.getState().select(null)
  expect(useSimClock.getState().rate).toBe(60)
  expect(transportVisibleNow()).toBe(true)
})
```
- [ ] **Step 2: Run it, expect PASS**: `npm test -w apps/web -- follow`. These tests describe behaviour the current code already has. They are there to protect it while Step 3 rewrites the condition, so a failure here is a bug in the test, not a missing feature.
- [ ] **Step 3: Implement**
  - `layerSync.ts:117`: the condition becomes `isDomainVisible(prev, 'orbital') && !isDomainVisible(state, 'orbital') && !isSimLive(simClock.get())`, and the body is unchanged: `simClock.get().resetToNow()`. Drop `transportVisible` from the import on line 4.
  - Rewrite the comment at :114-116: ORBITAL takes the time bar with it (`core/ui/transport`). Off NOW the bar hides for no other reason, so this is the one place a warped or paused clock could be stranded with the live feeds suspended. Snap it to real time.
  - `modeStore.ts`: delete lines 90-97 (doc comment and `transportVisible`).
  - `modeStore.test.ts`: `loadStore` imports and returns `{ useMode, backing }` only (lines 21-22). Delete the `it('transportVisible follows the ORBITAL layer only')` test (241-249).
- [ ] **Step 4: Run it, expect PASS**
  - `npm test -w apps/web -- follow modeStore` passes.
  - `grep -rnw transportVisible apps/web/src` prints nothing.
  - `(cd apps/web && npx tsc -b)` is clean; tsconfig includes the test files, so a stale import fails here.
  - `npm run lint && npm test` from the root is green.
- [ ] **Step 5: Commit**: `git add apps/web/src/app/globe/layerSync.ts apps/web/src/app/globe/follow.test.ts apps/web/src/core/ui/modeStore.ts apps/web/src/core/ui/modeStore.test.ts` then `git commit -m "refactor(web): retire modeStore.transportVisible"`

---

## Part 3: Legend for every domain that is on

The desktop left rail and the phone dock's picture sheet stack the picture of every visible domain in tab order (CATALOG, VESSELS, AIRCRAFT). With two or more stacked, each section heading becomes a fold toggle that shows a live count, and the fold is remembered per domain. The dock button reads the domain's name when one domain is on and `LEGEND` when two or more are. A catalog search pick now focuses ORBITAL before it selects, the way a globe tap does.

**Decisions that hold for every task below**
- **Who draws the heading.** `app/LegendSection.tsx` draws the stacked heading (fold button, label, count). The slice pictures do not change. Inside a stacked section, each picture's own first `<h2 className="hud-title">` (`CatalogPanel.tsx:17`, `MaritimePicture.tsx:38`, `AirPicture.tsx:137`) is hidden by CSS. This is the same trick `styles/sheet.css:42` already uses. ARCHITECTURE rule 4 holds: the per-mode UI stays in the slices, and app/ only composes it.
- **Where the count comes from.** The app layer reads the same store fields the LAYERS panel already shows (`app/LayersPanel.tsx:43-48`): `useCatalog(s => s.sats.length)`, `useShips(s => s.ships.length)` and `useAircraft(s => s.aircraft.length)`. VESSELS and AIRCRAFT read `SUSP` while sim time is off NOW (the LAYERS convention, `LayersPanel.tsx:118`). Satellites never read `SUSP`. app/ may import slice stores, and no slice imports another.
- **Stacked headings** show the label and the count both folded and unfolded, so toggling never shifts the row.
- **A lone section** renders as the bare `<entry.Component />` with no wrapper. The DOM is exactly today's: the desktop keeps "CATALOG" / "MARITIME PICTURE" / "AIR PICTURE", and on the phone the sheet title is the label and `sheet.css:42` still hides the inner title. A stored fold is ignored while the section is alone, not cleared, so it comes back when a second domain turns on.
- **No DOM test environment.** Vitest runs in plain node, with no jsdom and no Testing Library. The rules are therefore pure functions with unit tests, and the rendering is checked by running the app.

### Task 3.1: Catalog search pick focuses ORBITAL
**Files:**
- Create: `apps/web/src/features/catalog/searchPick.ts`
- Modify: `apps/web/src/features/catalog/CatalogPanel.tsx:3,62-63,96-98`
- Modify: `apps/web/src/features/catalog/CLAUDE.md:5,15,22`
- Modify: `docs/CONTROLS.md:39-40`
- Test: `apps/web/src/features/catalog/searchPick.test.ts`

**Interfaces:**
- Consumes:
  - `useSatellites.getState().registerSat(sat: Satellite)` and `.select(noradId: number | null)` (`core/ui/satelliteStore.ts:16-18`)
  - `useMode.getState().setMode(mode: OpsMode)` (`core/ui/modeStore.ts:49`)
- Produces: `pickSearchResult(sat: Satellite): void`

- [ ] **Step 0: Load the `frontend-slice-architecture` and `frontend-testing` skills.** The skill-routing hook blocks the first write under `features/**` until it is loaded.
- [ ] **Step 1: Write the failing test**
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { Satellite } from '@orbital-ops/shared'
import { useMode } from '../../core/ui/modeStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import { pickSearchResult } from './searchPick'

const ISS: Satellite = {
  noradId: 25_544, name: 'ISS (ZARYA)',
  tle1: '1'.padEnd(69, 'x'), tle2: '2'.padEnd(69, 'x'), groups: [],
}

beforeEach(() => {
  // CATALOG stacked under a focused MARITIME: the case a select-only pick got wrong
  useMode.setState({ mode: 'maritime', satellitesVisible: true, shipsVisible: true })
  useSatellites.setState({ byId: new Map(), selectedId: null })
})

describe('pickSearchResult', () => {
  it('focuses ORBITAL and selects the hit', () => {
    pickSearchResult(ISS)
    expect(useMode.getState().mode).toBe('orbital')
    expect(useSatellites.getState().selectedId).toBe(25_544)
  })

  it('registers and focuses before it selects, like a globe tap', () => {
    let atSelect: { mode: string; known: boolean } | null = null
    const off = useSatellites.subscribe((s, p) => {
      if (s.selectedId !== p.selectedId)
        atSelect = { mode: useMode.getState().mode, known: s.byId.has(25_544) }
    })
    pickSearchResult(ISS)
    off()
    expect(atSelect).toEqual({ mode: 'orbital', known: true })
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- searchPick`. It fails with "Failed to resolve import './searchPick'".
- [ ] **Step 3: Implement `pickSearchResult(sat: Satellite): void` in `features/catalog/searchPick.ts`.**
  - It calls, through `getState()`: `registerSat(sat)`, then `setMode('orbital')`, then `select(sat.noradId)`. This is the claimer's order at `app/globe/tapRouting.ts:49-50`. Follow needs nothing extra, because `GlobeFollow` reacts to the same store changes a tap makes.
  - In `CatalogPanel.tsx` `SearchBox`, delete the `registerSat` / `select` selectors (lines 62-63) and the now-unused `useSatellites` import (line 3). `pick` calls `pickSearchResult(sat)` and keeps `setOpen(false)` / `setQ(sat.name)`.
  - In `catalog/CLAUDE.md`:
    - Line 5, Depends on: add "`core/ui/modeStore` (`setMode('orbital')` on a search pick)".
    - Line 15: rewrite it as "`registerSat` (first registration wins) makes a search hit selectable while its group is inactive. `pickSearchResult` (`searchPick.ts`) calls it, then `setMode('orbital')`, then `select`. This is a globe tap's order (`app/globe/tapRouting.ts:49`), because the panel can render stacked under another focused domain whose details would hide the pick."
    - Line 22, How to test: add `-- searchPick`.
  - In `docs/CONTROLS.md`, after the sentence at line 39-40 ("Clicking an object that belongs to another domain switches to that mode and selects it."), add: "Picking a satellite from the CATALOG search does the same: focus moves to ORBITAL and its telemetry opens."
- [ ] **Step 4: Run it, expect PASS.** Then run `npm run lint && npm test` from the root and confirm it is green.
- [ ] **Step 5: Commit.** Run `git add apps/web/src/features/catalog/searchPick.ts apps/web/src/features/catalog/searchPick.test.ts apps/web/src/features/catalog/CatalogPanel.tsx apps/web/src/features/catalog/CLAUDE.md docs/CONTROLS.md`, then `git commit -m "feat(catalog): focus orbital on a search pick"`.

### Task 3.2: Legend fold store
**Files:**
- Create: `apps/web/src/core/ui/legendFoldStore.ts`
- Modify: `docs/ARCHITECTURE.md:16` and `AGENTS.md:22` (the list of `core/ui` stores)
- Test: `apps/web/src/core/ui/legendFoldStore.test.ts`

**Interfaces:**
- Consumes:
  - `OPS_MODES`, `type OpsMode` (`core/ui/modeStore.ts:3-4`)
  - `readStored`, `writeStored` (`lib/storage.ts:13,23`)
- Produces:
  - `type LegendFolds = Record<OpsMode, boolean>`
  - `interface LegendFoldState { folded: LegendFolds; toggleFold: (mode: OpsMode) => void }`
  - `useLegendFolds` (`create<LegendFoldState>`)

- [ ] **Step 1: Write the failing test.** Copy the `stubStorage` shim from `core/ui/modeStore.test.ts`; it already includes `removeItem` and `clear`.
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'orbital-ops.legend-folds'
const UNFOLDED = { orbital: false, maritime: false, airspace: false }

/* stubStorage(initial) — same shim as modeStore.test.ts */

async function loadStore(initial?: Record<string, string>) {
  const backing = stubStorage(initial)
  vi.resetModules()
  const { useLegendFolds } = await import('./legendFoldStore')
  return { useLegendFolds, backing }
}

afterEach(() => vi.unstubAllGlobals())

describe('legendFoldStore load', () => {
  it('starts with every section unfolded', async () => {
    const { useLegendFolds } = await loadStore()
    expect(useLegendFolds.getState().folded).toEqual(UNFOLDED)
  })
  it('restores the stored folds', async () => {
    const { useLegendFolds } = await loadStore({ [KEY]: JSON.stringify({ orbital: true }) })
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, orbital: true })
  })
  it('reads anything but true as unfolded and keeps only the three domains', async () => {
    const raw = JSON.stringify({ orbital: 'yes', maritime: 1, airspace: true, sun: true })
    const { useLegendFolds } = await loadStore({ [KEY]: raw })
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, airspace: true })
  })
  it.each(['null', '[]', '"folded"', '{not json'])('falls back to unfolded on %s', async (raw) => {
    const { useLegendFolds } = await loadStore({ [KEY]: raw })
    expect(useLegendFolds.getState().folded).toEqual(UNFOLDED)
  })
})

describe('toggleFold', () => {
  it('flips one domain and persists all three', async () => {
    const { useLegendFolds, backing } = await loadStore()
    useLegendFolds.getState().toggleFold('maritime')
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, maritime: true })
    expect(JSON.parse(backing.get(KEY) ?? 'null')).toEqual({ ...UNFOLDED, maritime: true })
    useLegendFolds.getState().toggleFold('maritime')
    expect(JSON.parse(backing.get(KEY) ?? 'null')).toEqual(UNFOLDED)
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- legendFoldStore`. It fails because the module cannot be resolved.
- [ ] **Step 3: Implement `useLegendFolds` in `core/ui/legendFoldStore.ts`.**
  - Add a file-local parse that builds a fresh record over `OPS_MODES`, with each value `=== true`. A non-object value gives all `false`.
  - The initial state is `readStored('orbital-ops.legend-folds', parse) ?? all false`.
  - `toggleFold` builds the next record, calls `writeStored` with the whole record, then sets it.
  - Not persisted: nothing else. Folds start unfolded (spec call 11).
  - Add `legend folds` to the store list at `docs/ARCHITECTURE.md:16` and `AGENTS.md:22`, keeping any entry Part 4 already added there.
- [ ] **Step 4: Run it, expect PASS.** Then run `npm run lint && npm test`.
- [ ] **Step 5: Commit.** Run `git add apps/web/src/core/ui/legendFoldStore.ts apps/web/src/core/ui/legendFoldStore.test.ts docs/ARCHITECTURE.md AGENTS.md`, then `git commit -m "feat(web): remember legend section folds per domain"`.

### Task 3.3: Legend rules in `app/railPicture.ts`
**Files:**
- Modify: `apps/web/src/app/railPicture.ts:1-27`
- Test: `apps/web/src/app/railPicture.test.ts` (create)

**Interfaces:**
- Consumes:
  - `OPS_MODES`, `isDomainVisible`, `useMode`, `type ModeState`, `type OpsMode` (`core/ui/modeStore`)
  - `useShallow` from `'zustand/react/shallow'` (zustand 5.0.14)
  - `formatCount` (`lib/format.ts:19`)
  - `LegendFolds` (Task 3.2)
- Produces:
  - `interface RailPictureEntry { mode: OpsMode; label: string; Component: ComponentType }`
  - `visiblePictures(s: Pick<ModeState, 'satellitesVisible' | 'shipsVisible' | 'aircraftVisible'>): RailPictureEntry[]`
  - `useRailPictures(): RailPictureEntry[]`
  - `pictureDockLabel(pictures: readonly RailPictureEntry[]): string | null`
  - `interface LegendSectionView { entry: RailPictureEntry; foldable: boolean; folded: boolean }`
  - `legendSections(pictures: readonly RailPictureEntry[], folded: Readonly<LegendFolds>): LegendSectionView[]`
  - `legendCount(mode: OpsMode, counts: Readonly<Record<OpsMode, number>>, simLive: boolean): string`
  - `useRailPicture` keeps its callers compiling until Task 3.4 deletes it.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it, vi } from 'vitest'

// The pictures are React panels whose stores poll and tick; the rules only need their identity.
vi.mock('../features/catalog/CatalogPanel', () => ({ CatalogPanel: () => null }))
vi.mock('../features/maritime/MaritimePicture', () => ({ MaritimePicture: () => null }))
vi.mock('../features/airspace/AirPicture', () => ({ AirPicture: () => null }))

import { legendCount, legendSections, pictureDockLabel, visiblePictures } from './railPicture'

const ALL_ON = { satellitesVisible: true, shipsVisible: true, aircraftVisible: true }
const [catalog, vessels, aircraft] = visiblePictures(ALL_ON)
const UNFOLDED = { orbital: false, maritime: false, airspace: false }

describe('visiblePictures', () => {
  it('lists every visible domain in tab order', () => {
    expect(visiblePictures(ALL_ON).map((p) => [p.mode, p.label])).toEqual([
      ['orbital', 'CATALOG'], ['maritime', 'VESSELS'], ['airspace', 'AIRCRAFT'],
    ])
  })
  it('skips hidden domains and keeps the order', () => {
    expect(visiblePictures({ ...ALL_ON, satellitesVisible: false }).map((p) => p.mode))
      .toEqual(['maritime', 'airspace'])
    expect(visiblePictures({ satellitesVisible: false, shipsVisible: false, aircraftVisible: false }))
      .toEqual([])
  })
  it('hands out the same entry objects every call (useShallow relies on it)', () => {
    const again = visiblePictures(ALL_ON)
    expect(again[0]).toBe(catalog)
    expect(again[1]).toBe(vessels)
    expect(again[2]).toBe(aircraft)
  })
})

describe('pictureDockLabel', () => {
  it('is null with no domain on', () => expect(pictureDockLabel([])).toBeNull())
  it('is the domain’s name with one on', () => expect(pictureDockLabel([vessels])).toBe('VESSELS'))
  it('is LEGEND with two or more on', () => {
    expect(pictureDockLabel([catalog, aircraft])).toBe('LEGEND')
    expect(pictureDockLabel([catalog, vessels, aircraft])).toBe('LEGEND')
  })
})

describe('legendSections', () => {
  it('a lone section cannot fold, even with a stored fold', () => {
    expect(legendSections([catalog], { ...UNFOLDED, orbital: true }))
      .toEqual([{ entry: catalog, foldable: false, folded: false }])
  })
  it('stacked sections fold per domain', () => {
    expect(legendSections([catalog, vessels], { orbital: true, maritime: false, airspace: true })).toEqual([
      { entry: catalog, foldable: true, folded: true },
      { entry: vessels, foldable: true, folded: false },
    ])
  })
})

describe('legendCount', () => {
  const counts = { orbital: 12_408, maritime: 3_120, airspace: 0 }
  it('is the formatted live count', () => {
    expect(legendCount('orbital', counts, true)).toBe('12 408')
    expect(legendCount('airspace', counts, true)).toBe('0')
  })
  it('reads SUSP for the live feeds while sim time is off NOW', () => {
    expect(legendCount('maritime', counts, false)).toBe('SUSP')
    expect(legendCount('airspace', counts, false)).toBe('SUSP')
  })
  it('never suspends satellites, which move in sim time', () => {
    expect(legendCount('orbital', counts, false)).toBe('12 408')
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- railPicture`. The `visiblePictures`, `pictureDockLabel`, `legendSections` and `legendCount` imports are undefined ("is not a function").
- [ ] **Step 3: Implement the rules in `app/railPicture.ts`.**
  - Each `PICTURES` entry gains its `mode`, and the entries stay module constants.
  - `visiblePictures` walks `OPS_MODES` through `isDomainVisible`. The list never depends on focus (spec call 5).
  - `useRailPictures()` is `useMode(useShallow(visiblePictures))`. A plain selector that returns a new array makes zustand 5 re-render forever.
  - `pictureDockLabel`: `null` for 0 entries, `entries[0].label` for 1, `'LEGEND'` for 2 or more.
  - `legendSections`: `foldable = pictures.length > 1`, `folded = foldable && folded[entry.mode]`.
  - `legendCount`: `'SUSP'` when `mode !== 'orbital' && !simLive`, otherwise `formatCount(counts[mode])`.
  - Update the file's doc comment: it is now the one place for the legend rules shared by the rail, the dock and the sheet.
- [ ] **Step 4: Run it, expect PASS.** Then run `npm run lint && npm test`.
- [ ] **Step 5: Commit.** Run `git add apps/web/src/app/railPicture.ts apps/web/src/app/railPicture.test.ts`, then `git commit -m "feat(web): list every visible domain's picture for the legend"`.

### Task 3.4: Stacked, foldable legend in the rail and the dock
**Files:**
- Create: `apps/web/src/app/LegendSection.tsx`
- Create: `apps/web/src/styles/legend.css`
- Modify: `apps/web/src/styles/index.css:30` (insert `@import './legend.css';` right after `@import './rail.css';`)
- Modify: `apps/web/src/app/LeftRail.tsx:1-26`
- Modify: `apps/web/src/app/CompactHud.tsx:9-10,74,79,95-99,122-131`
- Modify: `apps/web/src/app/railPicture.ts` (delete `useRailPicture`)
- Modify: `apps/web/src/app/compactSheets.ts:15-19` (doc comment only)
- Modify: `apps/web/src/core/ui/sheetStore.ts:7` (doc comment only)
- Modify: `apps/web/src/app/HelpOverlay.tsx:18`
- Modify: `docs/CONTROLS.md:13-15,83`
- Test: `apps/web/src/app/compactSheets.test.ts:21` (rename only)

**Interfaces:**
- Consumes:
  - `useLegendFolds` (Task 3.2); `useRailPictures`, `pictureDockLabel`, `legendSections`, `legendCount`, `LegendSectionView` (Task 3.3)
  - `useCatalog` (`features/catalog/catalogStore.ts`), `useShips` (`features/maritime/shipsStore.ts`), `useAircraft` (`features/airspace/aircraftStore.ts`), `useSimLive` (`core/sim/simLive.ts`)
- Produces:
  - `RailPictures()` component in `LeftRail.tsx` (replaces `RailPicture`)
  - `LegendSection({ view }: { view: LegendSectionView })`
  - CSS classes `.legend-section`, `.legend-heading`, `.legend-fold`, `.legend-chevron`, `.legend-label`, `.legend-count`, `.legend-body`
  - DOM id `legend-body-<mode>`. It is unique because App mounts either `LeftRail` or `CompactHud`, never both (`App.tsx:65-80`).

- [ ] **Step 1: Rename the visibleSheet test.** `visibleSheet` keeps its signature and behaviour, so no new unit test. In `compactSheets.test.ts:21`, rename `'closes the picture sheet while the focused domain has no picture'` to `'closes the picture sheet while no domain is on'` and keep its assertions. The rules are pinned in Tasks 3.2 and 3.3.
- [ ] **Step 2: Implement `LegendSection` in `app/LegendSection.tsx`.**
  - A file-local hook `useLegendCount(mode)` reads all three counts and `useSimLive()` unconditionally (no hook inside a branch), then returns `legendCount(mode, { orbital, maritime, airspace }, simLive)`.
  - The markup below is the contract the CSS and the disclosure semantics rely on. The body element stays mounted so `aria-controls` always resolves, but the picture unmounts while folded so its stores stop re-rendering it.
```tsx
<section className="legend-section">
  <h2 className="hud-title legend-heading">
    <button type="button" className="legend-fold" aria-expanded={!view.folded}
      aria-controls={`legend-body-${mode}`} onClick={() => toggleFold(mode)}>
      <span className="legend-chevron" aria-hidden>▾</span>
      <span className="legend-label">{view.entry.label}</span>
      <span className="legend-count">{count}</span>
    </button>
  </h2>
  <div id={`legend-body-${mode}`} className="legend-body" hidden={view.folded}>
    {!view.folded && <view.entry.Component />}
  </div>
</section>
```
- [ ] **Step 3: Implement `RailPictures()` in `LeftRail.tsx`.**
  - It renders `legendSections(useRailPictures(), useLegendFolds((s) => s.folded))`, mapped with `key={view.entry.mode}`: a foldable view renders `<LegendSection view={view} />`, and any other view renders the bare `<view.entry.Component />`.
  - `LeftRail` renders `<RailPictures />` above `<LayersPanel />`.
  - Rewrite both doc comments: every visible domain's picture, in tab order.
  - Delete `useRailPicture` from `railPicture.ts`.
- [ ] **Step 4: Edit `CompactHud.tsx`.** Part 4's `useTransportVisible()` lines stay as they are.
  - Imports: `RailPictures` from `./LeftRail`; `pictureDockLabel` and `useRailPictures` from `./railPicture`.
  - Line 74: `const dockLabel = pictureDockLabel(useRailPictures())`.
  - Line 79: `visibleSheet(sheet, dockLabel !== null, hasSelection)`.
  - Lines 95-99: render `<Sheet sheet="picture" title={dockLabel}><RailPictures /></Sheet>` when `openSheet === 'picture' && dockLabel !== null`.
  - Lines 122-131: render the dock button when `dockLabel !== null`, with `{dockLabel}` as its text.
  - The `compactSheets.ts:15-19` doc says `picture` needs at least one visible domain's picture.
  - The `sheetStore.ts:7` doc says `picture` is the left-rail pictures of every visible domain (one LEGEND sheet with two or more).
- [ ] **Step 5: Write `styles/legend.css`.** Dispatch `@hud-designer`; CLAUDE.md routes every visual change to it. Hard rules, with colours from tokens only:
  - `.legend-heading` zeroes the `.hud-title` bottom margin (`panel.css:59-66`).
  - `.legend-fold` is a full-width, transparent, borderless flex row: chevron, label, then the count pushed right with tabular numerals. It inherits the title's font, colour, letter-spacing and uppercase. Under `@media (pointer: coarse)` it gets `min-height: var(--tap)` (44 px).
  - Under `@media (hover: hover)`, hover brightens it to `var(--text)` like `.group-row` (`rail.css:71-76`).
  - `.legend-fold[aria-expanded="false"] .legend-chevron` rotates −90° with `var(--t-fast) var(--ease-out)`. `base.css:76` already removes transitions under reduced motion, so do not add an override.
  - `.legend-section + .legend-section` is separated by a `var(--hairline)` top border and spacing, matching `.infra-title` (`rail.css:182-186`).
  - Add `.legend-body > .hud-title:first-child { display: none; }`, with a comment that it relies on each picture rendering its `<h2 className="hud-title">` first, like `sheet.css:42`.
- [ ] **Step 6: Update the docs.**
  - `HelpOverlay.tsx:18`: the row becomes `['LEGEND · LAYERS', 'Dock buttons: open the legend (named after the domain when only one is on) / layer sheet; with two or more on, tap a heading to fold it']`.
  - `docs/CONTROLS.md:13-15`: "the focused mode drives which left-rail and right-stack panels are shown" becomes: "the focused mode drives the right-stack panels and which layer clicks resolve to first. The left rail shows the picture of every domain that is on, stacked in tab order (CATALOG, VESSELS, AIRCRAFT) above LAYERS. On a phone, one dock button opens them all: it carries the domain's name when one is on and LEGEND when two or more are. With two or more on, tap a section heading to fold it to one row with its live count (SUSP for vessels and aircraft while sim time is off NOW). Folds are remembered per domain in this browser, and a lone section never folds."
  - `docs/CONTROLS.md:83`: `(catalog / layers / details)` becomes `(legend / layers / details)`.
- [ ] **Step 7: Run the app.** Run `npm run lint && npm test` (green), then `npm run dev`. On desktop:
  1. With ORBITAL alone on, the rail looks exactly as before: an "CATALOG" h2, no chevron, then LAYERS.
  2. Press `2`. The rail shows `▾ CATALOG <n>` with the catalog body (no second CATALOG title), then `▾ VESSELS <n>` with no "MARITIME PICTURE" title, then LAYERS. CATALOG stays first although MARITIME is focused.
  3. Click the CATALOG heading. The body collapses, the count stays, and `aria-expanded="false"` is set. After a reload CATALOG is still folded.
  4. Press `2` again. CATALOG renders as in (1), with no button. Press `2` once more and CATALOG is folded again.
  5. Press `3`. Warp time (select a satellite, then `.`): the VESSELS and AIRCRAFT headings read SUSP, and CATALOG keeps a number.
  6. Tab to a heading. Enter and Space toggle it, and the focus ring shows.
  7. With MARITIME focused, search "ISS" in the stacked CATALOG and pick the result. The ORBITAL tab takes focus and telemetry opens in the right stack.
  8. The console shows no "Maximum update depth exceeded" and no "getSnapshot should be cached".

  Then in DevTools phone emulation (360 × 800, touch):
  - One domain on: the dock reads CATALOG, the sheet title is CATALOG, and there is no duplicate title.
  - Two on: the dock reads LEGEND, the sheet title is LEGEND, and every section heading is visible and at least 44 px tall. Folding CATALOG brings VESSELS into view, and the sheet scrolls within 55dvh.
  - A search pick from the LEGEND sheet closes it and the chip shows the satellite.
  - All five dock buttons fit at 360 px.
  - Take a screenshot of each state.
- [ ] **Step 8: Commit.** Run `git add apps/web/src/app/LegendSection.tsx apps/web/src/app/LeftRail.tsx apps/web/src/app/CompactHud.tsx apps/web/src/app/railPicture.ts apps/web/src/app/compactSheets.ts apps/web/src/app/compactSheets.test.ts apps/web/src/core/ui/sheetStore.ts apps/web/src/app/HelpOverlay.tsx apps/web/src/styles/legend.css apps/web/src/styles/index.css docs/CONTROLS.md`, then `git commit -m "feat(web): stack foldable legends of every visible domain"`.

---

## Part 1: Colour picker and palette

This part changes the default palette to v2: one meaning gets one hue in every domain, and amber is kept for the selection only. On load, `core/ui/prefsStore` migrates v1 prefs to v2 once and saves the result. The portalled `SwatchPopover` becomes an inline `SwatchPicker`, a full-width child of the COLORS `.color-grid`. That removes the close-on-scroll/resize that broke hex entry on the phone. The swatch grid is rebuilt as 8 hue columns × 4 lightness rows.

No engine or slice code changes. Layers already receive the palette through `setPalette`, and aircraft altitude shades multiply whatever hue they get (`features/airspace/AircraftLayer.ts:19-39`). The grep for old hexes needed no other edits:
- `core/engine/signalColors.ts` and `--amber`, `--cyan`, `--alert`, `--aircraft-ground` in `tokens.css` are signal colours.
- `--signal-white` is the colour of the LAYERS AIRCRAFT row, not a palette default.
- The airspace, maritime and constellation `CLAUDE.md` files only name `DEFAULT_COLORS.*` as the seed.

Order: 1.1 → 1.2 → 1.3. Each task leaves `npm run lint && npm test` green, because every v2 default is already in today's grid. None of the folders touched has a `CLAUDE.md`.

### Task 1.1: v2 default palette and v1 → v2 migration

**Files:**
- Modify: `apps/web/src/core/ui/prefsStore.ts:15-33` (doc + `DEFAULT_COLORS`), `:47-96` (stored shape, merge, parse, persist), `:106-107` (initial state)
- Modify: `apps/web/src/app/SettingsPanel.tsx:138-140` (footnote)
- Modify: `docs/CONTROLS.md:26-28`
- Test: `apps/web/src/core/ui/prefsStore.test.ts`

**Interfaces:**
- Consumes: `readStored` / `writeStored` (`lib/storage.ts`). In the test only: `SIGNAL_AMBER` and `SIGNAL_GROUND` (`core/engine/signalColors.ts`).
- Produces:
  - `DEFAULT_COLORS: ColorPrefs` with the v2 values. Name and type are unchanged, so layers, `layerSync`, legends and `swatches.test.ts` pick it up as they are.
  - Every write to `localStorage['orbital-ops.prefs']` carries `paletteVersion: 2`.
  - Module-private: `PALETTE_VERSION = 2`, `V1_DEFAULT_COLORS`, `loadPrefs(): StoredPrefs`. `PrefsState` does **not** gain a version field.

- [ ] **Step 1: Write the failing test.** Add to `prefsStore.test.ts`, reusing its `loadStore`, `STORAGE_KEY` and `CAMERA`:
```ts
import { SIGNAL_AMBER, SIGNAL_GROUND } from '../engine/signalColors'

/** Written out, not imported: editing the frozen v1 table or the v2 defaults fails here. */
const V1 = {
  aircraft: { civil: '#4da6ff', cargo: '#f87171', military: '#7dd87d' },
  ships: { cargo: '#6ee7ff', tanker: '#ffb454', passenger: '#c084fc', fishing: '#7dd87d', highspeed: '#f0f4f8', military: '#f87171', other: '#8a93a3' },
  satellites: { LEO: '#ffb454', MEO: '#6ee7ff', GEO: '#c084fc', HEO: '#f87171' },
}
const V2 = {
  aircraft: { civil: '#4da6ff', cargo: '#7dd87d', military: '#f87171' },
  ships: { cargo: '#7dd87d', tanker: '#c084fc', passenger: '#4da6ff', fishing: '#2dd4bf', highspeed: '#ff5f8f', military: '#f87171', other: '#8a93a3' },
  satellites: { LEO: '#a8f0ff', MEO: '#a3e635', GEO: '#ffd166', HEO: '#ffa1b5' },
}
const stored = (b: Map<string, string>) => JSON.parse(b.get(STORAGE_KEY)!)

describe('prefsStore palette v2', () => {
  it('defaults to one hue per meaning', async () => {
    expect((await loadStore()).DEFAULT_COLORS).toEqual(V2)
  })
  it('paints a shared meaning alike in every domain and never defaults to the selection amber', async () => {
    const d = (await loadStore()).DEFAULT_COLORS
    expect(d.ships.military).toBe(d.aircraft.military)
    expect(d.ships.passenger).toBe(d.aircraft.civil)
    expect(d.ships.cargo).toBe(d.aircraft.cargo)
    expect(d.ships.other).toBe(SIGNAL_GROUND)
    expect(Object.values(d).flatMap((x) => Object.values(x))).not.toContain(SIGNAL_AMBER)
  })
})

describe('prefsStore v1 -> v2 migration', () => {
  it('moves an untouched v1 palette to the v2 defaults and persists it as v2 at load', async () => {
    const { usePrefs, backing } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors: V1, lastCamera: CAMERA, basemap: 'topo' }) })
    expect(usePrefs.getState().colors).toEqual(V2)
    expect(stored(backing)).toEqual({ paletteVersion: 2, colors: V2, lastCamera: CAMERA, basemap: 'topo' })
  })
  it("keeps every colour the user picked, including another key's v1 default", async () => {
    const colors = { ...V1, ships: { ...V1.ships, cargo: '#7dd87d', tanker: '#c27a2e' }, satellites: { ...V1.satellites, LEO: '#123456' } }
    const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors }) })
    const c = usePrefs.getState().colors
    expect([c.ships.cargo, c.ships.tanker, c.satellites.LEO]).toEqual(['#7dd87d', '#c27a2e', '#123456'])
    expect([c.ships.fishing, c.satellites.MEO]).toEqual(['#2dd4bf', '#a3e635'])
  })
  it('matches a v1 default case-insensitively', async () => {
    const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors: { ships: { tanker: '#FFB454' } } }) })
    expect(usePrefs.getState().colors.ships.tanker).toBe('#c084fc')
  })
  it('reads v2 prefs unchanged and writes nothing at load', async () => {
    const raw = JSON.stringify({ paletteVersion: 2, colors: { ...V2, ships: { ...V2.ships, tanker: '#ffb454' } } })
    const { usePrefs, backing } = await loadStore({ [STORAGE_KEY]: raw })
    expect(usePrefs.getState().colors.ships.tanker).toBe('#ffb454')
    expect(backing.get(STORAGE_KEY)).toBe(raw)
  })
  it('treats a missing or non-2 version as v1 and still drops invalid colours', async () => {
    for (const paletteVersion of [undefined, 1, '2', null]) {
      const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ paletteVersion, colors: { ships: { tanker: '#ffb454', cargo: 'cyan' }, satellites: 42 } }) })
      const c = usePrefs.getState().colors
      expect([c.ships.tanker, c.ships.cargo], String(paletteVersion)).toEqual(['#c084fc', '#7dd87d'])
      expect(c.satellites).toEqual(V2.satellites)
    }
  })
  it('stamps paletteVersion 2 on every write, so a reload never re-migrates a pick', async () => {
    const first = await loadStore()
    first.usePrefs.getState().setColor('ships', 'tanker', '#ffb454')
    expect(stored(first.backing).paletteVersion).toBe(2)
    const again = await loadStore({ [STORAGE_KEY]: first.backing.get(STORAGE_KEY)! })
    expect(again.usePrefs.getState().colors.ships.tanker).toBe('#ffb454')
  })
})
```
  Also amend two existing tests:
  - "falls back to defaults on corrupted JSON": add `expect(backing.get(STORAGE_KEY)).toBe('{not json')`, so corrupt storage is not overwritten at load.
  - "resetColors restores the defaults…": add `expect(stored(backing).colors).toEqual(V2)` and `expect(stored(backing).paletteVersion).toBe(2)`.
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- prefsStore`. Expected: "defaults to one hue per meaning" fails on the v1 values, and the migration tests fail because colours stay v1 and nothing writes `paletteVersion`.
- [ ] **Step 3: Implement in `prefsStore.ts`:**
  - **`DEFAULT_COLORS`** is exactly the `V2` literal above. Rewrite its doc comment along these lines: one meaning, one hue across domains (military red, civil/passenger blue, cargo green, tanker violet, fishing teal, high-speed hot pink, other grey = `SIGNAL_GROUND`); satellites stay off the selection amber; aircraft altitude still sets the shade in the layer.
  - **`V1_DEFAULT_COLORS`**: move today's literal (`prefsStore.ts:22-32`) here verbatim.
    - Type it `Readonly<Record<keyof ColorPrefs, Readonly<Record<string, string>>>>`, not `ColorPrefs`, so a category added later has no v1 entry and never forces an invented one.
    - Doc comment: "Frozen: the defaults every visitor stored before palette v2. History, not config — never edit."
  - **`mergeColors(stored, fromV1: boolean)`**: a valid hex is replaced by `DEFAULT_COLORS[domain][key]` when `fromV1 && value.toLowerCase() === V1_DEFAULT_COLORS[domain][key]`, and kept otherwise. Invalid or missing values fall back to the v2 default, as today.
  - **`parseStoredPrefs(value): { prefs: StoredPrefs; migrated: boolean }`** with `migrated = parsed.paletteVersion !== PALETTE_VERSION`. Only the number `2` counts as v2.
  - **`persist`** writes `{ paletteVersion: PALETTE_VERSION, colors, lastCamera, basemap }`.
  - **`loadPrefs()`**: if `readStored(STORAGE_KEY, parseStoredPrefs)` is undefined (nothing stored, corrupt JSON, stored `null`), return `defaultPrefs()` and write nothing. Otherwise, if `migrated`, `persist(prefs)` once, then return `prefs`. The store initializer spreads `loadPrefs()`.
  - **`SettingsPanel.tsx`**: add a second `<p className="help-footnote">` before the existing one: `Defaults give each meaning one hue in every domain. Amber marks the selected object only.`
  - **`docs/CONTROLS.md`**: after the sentence ending "including your COLORS choices." (line 28; Part 3 may have edited the lines around it, so anchor on that sentence), add this paragraph: "Default colours mean the same thing in every domain: red military, blue civil aircraft / passenger vessels, green cargo, violet tanker, teal fishing, pink high-speed craft, grey other (and aircraft on the ground). Satellites: LEO ice, MEO lime, GEO gold, HEO pink. Amber is never a default; it marks the selected or followed object. Colours you changed yourself survive the switch to these defaults; RESET in COLORS restores the defaults."
- [ ] **Step 4: Run it, expect PASS.** Then check the gate (`npm run lint && npm test`) and the running app (`npm run dev`, http://localhost:5173):
  - In the DevTools console, run `localStorage.setItem('orbital-ops.prefs', JSON.stringify({colors:{ships:{tanker:'#c27a2e',cargo:'#6ee7ff'}}}))` and reload.
  - COLORS must show v2 everywhere, except TANKER, which stays dim amber.
  - Application → Local Storage must show `"paletteVersion":2`.
  - With VESSELS and AIRCRAFT both on, cargo is green and military is red in both domains; a selected satellite is still amber.
  - Look at LEO/GEO dots at whole-Earth view on the `streets` and `satellite` basemaps and report how legible they are. Write down the legibility notes; Task 1.3 hands them to `@hud-designer`.
- [ ] **Step 5: Commit**: `git add apps/web/src/core/ui/prefsStore.ts apps/web/src/core/ui/prefsStore.test.ts apps/web/src/app/SettingsPanel.tsx docs/CONTROLS.md` then `git commit -m "feat(web): one hue per meaning in default colours, migrate v1 prefs"`

### Task 1.2: Inline `SwatchPicker` replaces the popover

**Files:**
- Create: `apps/web/src/app/SwatchPicker.tsx`
- Delete: `apps/web/src/app/SwatchPopover.tsx`
- Modify: `apps/web/src/app/SettingsPanel.tsx:1-68` (header doc, `ColorRow`)
- Modify: `apps/web/src/app/swatches.ts` (add `parseHexInput`; the doc comment becomes "palette data and its hex-input rule")
- Modify: `apps/web/src/styles/colors.css:5-9, 25-29, 55-124`; `apps/web/src/styles/panel.css:36-40`; `apps/web/src/styles/tokens.css:24, 74-83, 118-125`
- Modify: `docs/CONTROLS.md:82-83` and the paragraph added in 1.1
- Test: `apps/web/src/app/swatches.test.ts`

**Interfaces:**
- Consumes: `SWATCHES` (`app/swatches.ts`); `usePrefs().setColor`.
- Produces:
  - `parseHexInput(text: string): string | null`. It trims the text, accepts `#RRGGBB` or bare `RRGGBB` in either case, and returns lower-case `#rrggbb`; anything else returns `null`.
  - The component:
```ts
export function SwatchPicker(props: {
  id: string          // DOM id; the chip's aria-controls points here
  label: string       // row label, e.g. "CARGO"
  fieldName: string   // `name` of the hex field
  value: string       // stored #rrggbb
  onSelect: (hex: string) => void  // writes the store; picker stays open
  onClose: () => void              // caller closes and refocuses the chip
})  // no return annotation: React 19 types have no global JSX namespace
```
- [ ] **Step 1: Write the failing test** in `swatches.test.ts`:
```ts
describe('parseHexInput', () => {
  it('accepts #RRGGBB and bare RRGGBB, trimmed, as lower-case #rrggbb', () => {
    expect(parseHexInput('#4DA6FF')).toBe('#4da6ff')
    expect(parseHexInput('4da6ff')).toBe('#4da6ff')
    expect(parseHexInput('  #2DD4BF ')).toBe('#2dd4bf')
  })
  it('rejects anything else', () => {
    for (const bad of ['', '#', '#fff', 'fff', '#12345g', '##4da6ff', '#4da6ff0', 'rgb(1,2,3)'])
      expect(parseHexInput(bad), bad).toBeNull()
  })
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- swatches`. Expected error: `TypeError: parseHexInput is not a function`.
- [ ] **Step 3: Implement.**
  - Dispatch `@hud-designer` (opus) for the CSS in this step; the blocks below are its starting point. Fixed: the picker renders inline under its row pair, never closes on scroll, resize or hex focus, and its targets are ≥ 44 px on touch.
  - **`swatches.ts`**: add `parseHexInput`.
  - **`SwatchPicker.tsx`** keeps today's draft logic (`SwatchPopover.tsx:37-41`) and swatch markup (`:126-144`, including `aria-pressed`, `data-selected`, and `aria-label`/`title` = `${name} ${HEX}`). Everything else changes:
    - Root: `<div id className="swatch-picker" role="group" aria-label={`${label} color picker`} onKeyDown>`. On `Escape`, call `e.stopPropagation()` then `onClose()`. The React handler is enough: the globe's Escape handler is bubble phase on window (`app/globe/globeKeys.ts:36-41,106`), and the hex field is a typing target the globe ignores (`core/ui/keyboard.ts:8`).
    - **No `window` or `document` listeners at all**: no scroll, no resize, no outside pointerdown. The only ways to close are a swatch pick, Escape, the chip again, or another row's chip.
    - Mount: use a stable callback ref (`useCallback(…, [])`) that runs `node.scrollIntoView({ block: 'nearest' })`, then focuses `[data-selected="true"]` (or the first `.swatch`) with `{ preventScroll: true }`.
    - Swatch click: `onSelect(hex)` then `onClose()`.
    - Hex field: commit = `const hex = parseHexInput(text); setDraft(null); if (hex) onSelect(hex)`, run on blur and on Enter. Escape from the field refocuses the chip, and the field's blur commits a valid draft, as it does today; do not add cancel logic. Markup:
      `<label className="swatch-hex-row"><span className="swatch-hex-label">HEX</span><input className="hud-input swatch-hex" name={fieldName} value={text} maxLength={7} inputMode="text" autoCapitalize="characters" autoComplete="off" enterKeyHint="done" spellCheck={false} aria-label={`${label} hex value`} …/></label>`
  - **`ColorRow`** (`SettingsPanel.tsx`):
    - It returns a Fragment: `<div className="color-row">…</div>{open && <SwatchPicker …/>}`. The picker is then a **direct child of `.color-grid`**, right after its opener in the DOM, so Tab order runs chip → swatches → hex → next chip.
    - `pickerId = `color-picker-${domain}-${colorKey}``.
    - Chip: remove `aria-haspopup`, keep `aria-expanded={open}`, add `aria-controls={open ? pickerId : undefined}`.
    - `close = useCallback(() => { setOpenPicker(null); chipRef.current?.focus() }, [setOpenPicker])`.
    - Header doc: chips open the inline picker (`app/SwatchPicker`) under their row pair.
    - Delete `SwatchPopover.tsx`.
  - **`tokens.css`**:
    - Delete `--shadow-pop` (`:24`); `.swatch-popover` was its only user.
    - Add to the geometry block: `--swatch: 32px; /* COLORS swatch floor: 8 columns fit the 320px phone dialog */`, `--swatch-max: 32px;`, `--swatch-gap: 6px;`.
    - In the `@media (pointer: coarse)` `:root` block: `--swatch-max: var(--tap-min);`.
  - **`colors.css`** (starting point for `@hud-designer`):
```css
.color-grid { /* existing display/columns/gap */ grid-auto-flow: row dense; }
/* the picker follows its opener in the DOM and takes a whole row; dense lets the
   opener's row partner backfill beside it, so the picker sits under the pair */
.swatch-picker {
  position: relative; /* anchors the amber corner tick (panel.css) */
  grid-column: 1 / -1;
  margin: var(--sp-1) 0 var(--sp-2);
  padding: var(--sp-2);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  background: var(--input-bg);
}
/* 8 = SWATCH_COLUMNS (app/swatches.ts; swatches.test.ts reads this line).
   Phone: 320px content - 18px picker chrome = 302px >= 8 x 32 + 7 x 6 = 298px;
   the selected ring (3px) fits in the 6px gap and the 8px padding. */
.swatch-grid { display: grid; grid-template-columns: repeat(8, minmax(var(--swatch), var(--swatch-max))); gap: var(--swatch-gap); }
.swatch { width: 100%; height: auto; aspect-ratio: 1 / 1; /* rest unchanged */ }
.swatch-hex-row { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); }
.swatch-hex-label { font-size: var(--fs-label); letter-spacing: var(--ls-label); color: var(--text-dim); }
.swatch-hex { width: 11ch; text-transform: uppercase; font-variant-numeric: tabular-nums; }
```
    Also delete the `.swatch-popover` rule, the portal comment (`:25-29`) and the coarse `.swatch-grid` / `.swatch` overrides; the token handles them. Keep the coarse `.color-chip` rule.
  - **`panel.css`**: change the selector `.swatch-popover::before` → `.swatch-picker::before` and reword the comment to say the inline picker wears the tick without a chamfer.
  - **`docs/CONTROLS.md`**:
    - In the ESC bullet ("ESC is staged, one layer per press", today :82-84; the sentence wraps), insert "an open colour picker, then" right before "the COLORS panel". Part 3 already changed "(catalog / …)" to "(legend / …)" in the same bullet; keep it. Anchor on the words, not the line numbers.
    - Append to the 1.1 paragraph: "In COLORS, tap a chip to open its picker under that row: pick a swatch, or type a hex value (`#RRGGBB` or `RRGGBB`; Enter or leaving the field applies it). The picker closes on a swatch pick, ESC, or the chip again."
    - `HelpOverlay.tsx` is unchanged.
- [ ] **Step 4: Run it, expect PASS.** Check the gate, then run the app:
  - **Desktop:**
    - Open COLORS and click VESSELS CARGO. The picker opens under the CARGO | TANKER pair across both columns, and TANKER stays beside CARGO.
    - Click TANKER: CARGO's picker closes and TANKER's opens under the same pair.
    - ESC closes only the picker and puts focus on the chip; a second ESC closes COLORS.
    - Type `2dd4bf` + Enter: the chip turns teal. Type `#zz` and leave the field: the value reverts.
    - Scroll the dialog and resize the window with the picker open: it stays open.
    - Tab goes chip → swatches → HEX → next chip.
    - Confirm `grep -n addEventListener apps/web/src/app/SwatchPicker.tsx` prints nothing.
  - **DevTools phone emulation, 360×740 with touch:**
    - Open SATELLITES HEO. The picker sits under it, the dialog scrolls it into view, 8 swatches fit per row with no horizontal scroll, and the selected ring is not clipped.
    - Tap HEX: the picker stays open.
    - The console has no errors.
- [ ] **Step 5: Commit**: `git add apps/web/src/app/SwatchPicker.tsx apps/web/src/app/SwatchPopover.tsx apps/web/src/app/SettingsPanel.tsx apps/web/src/app/swatches.ts apps/web/src/app/swatches.test.ts apps/web/src/styles/colors.css apps/web/src/styles/panel.css apps/web/src/styles/tokens.css docs/CONTROLS.md` then `git commit -m "fix(web): render the colour picker inline so hex entry works"`

### Task 1.3: Swatch grid of hue columns × lightness rows

**Files:**
- Modify: `apps/web/src/app/swatches.ts:1-38` (doc, `SWATCHES`, new constants)
- Test: `apps/web/src/app/swatches.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_COLORS` (Task 1.1); `colors.css` `repeat(8, …)` (Task 1.2).
- Produces: `SWATCHES` (32 entries, row-major), `SWATCH_COLUMNS = 8`, `SWATCH_ROWS = 4`.

- [ ] **Step 1: Write the failing test.** Replace the "six per row" test. Keep the "offers every default colour" test.
```ts
import { readFileSync } from 'node:fs'
import { SIGNAL_AMBER } from '../core/engine/signalColors'
import { SWATCHES, SWATCH_COLUMNS, SWATCH_ROWS } from './swatches'

// read from disk: vitest serves CSS as an empty module (see core/engine/signalColors.test.ts)
const colorsCss = readFileSync(new URL('../styles/colors.css', import.meta.url), 'utf8')
/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const at = (row: number, col: number) => SWATCHES[row * SWATCH_COLUMNS + col]

it('is a full grid of at most 8 hue columns by 4 shade rows', () => {
  expect(SWATCH_COLUMNS).toBeLessThanOrEqual(8)
  expect(SWATCH_ROWS).toBe(4)
  expect(SWATCHES).toHaveLength(SWATCH_COLUMNS * SWATCH_ROWS)
})
it('holds unique lower-case #rrggbb values with unique upper-case names', () => {
  for (const s of SWATCHES) { expect(s.hex).toMatch(/^#[0-9a-f]{6}$/); expect(s.name).toMatch(/^[A-Z][A-Z ]*$/) }
  expect(new Set(SWATCHES.map((s) => s.hex)).size).toBe(SWATCHES.length)
  expect(new Set(SWATCHES.map((s) => s.name)).size).toBe(SWATCHES.length)
})
it('runs every column light -> base -> deep -> dim', () => {
  for (let col = 0; col < SWATCH_COLUMNS; col++)
    for (let row = 1; row < SWATCH_ROWS; row++)
      expect(luminance(at(row, col).hex), at(row, col).name).toBeLessThan(luminance(at(row - 1, col).hex))
})
it('keeps every swatch visible on the picker well (luminance >= 0.12, about 3:1 on #131820)', () => {
  for (const s of SWATCHES) expect(luminance(s.hex), s.name).toBeGreaterThanOrEqual(0.12)
})
it('never offers the selection amber', () => {
  expect(SWATCHES.map((s) => s.hex)).not.toContain(SIGNAL_AMBER)
})
it('matches the column count styles/colors.css lays out', () => {
  expect(colorsCss).toMatch(new RegExp(`grid-template-columns:\\s*repeat\\(${SWATCH_COLUMNS},`))
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- swatches`. Expected: `SWATCH_COLUMNS` / `SWATCH_ROWS` are undefined (grid-size and ramp tests fail), and "never offers the selection amber" fails because today's grid holds `#ffb454`.
- [ ] **Step 3: Implement `SWATCHES`, `SWATCH_COLUMNS = 8`, `SWATCH_ROWS = 4` in `swatches.ts`.** The table below is the starting point, row-major (8 per row). Columns run in colour-wheel order: RED, PINK, VIOLET, BLUE, ICE→TEAL, LIME→GREEN, GOLD, GREY. A trailing comment names the v2 meaning on each default. Dispatch `@hud-designer` (opus) with it and the Task 1.1 legibility notes. It may change shades and names within the rules the tests pin: 8 columns, swatches ≥ 32 px inside the 302 px phone well, a strictly falling luminance ramp per column, luminance ≥ 0.12, no `#ffb454`, every v2 default present, meaning→hue fixed.

| row \ col | RED | PINK | VIOLET | BLUE | ICE→TEAL | LIME→GREEN | GOLD | GREY |
|---|---|---|---|---|---|---|---|---|
| LIGHT | `#fca5a5` LIGHT RED | `#ffa1b5` PINK (HEO) | `#dcbcff` LILAC | `#a3d0ff` SKY | `#a8f0ff` ICE (LEO) | `#a3e635` LIME (MEO) | `#ffe7a3` PALE GOLD | `#c7d0dc` SILVER |
| BASE | `#f87171` RED (military) | `#ff5f8f` HOT PINK (high-speed) | `#c084fc` VIOLET (tanker) | `#4da6ff` BLUE (civil, passenger) | `#2dd4bf` TEAL (fishing) | `#7dd87d` GREEN (cargo) | `#ffd166` GOLD (GEO) | `#8a93a3` GREY (other) |
| DEEP | `#dc4c4c` DEEP RED | `#e0457b` DEEP PINK | `#9d62e8` DEEP VIOLET | `#2f7fe0` DEEP BLUE | `#14a899` DEEP TEAL | `#3fae5a` DEEP GREEN | `#e0b030` DEEP GOLD | `#6f7886` SLATE |
| DIM | `#a84444` DIM RED | `#a3416a` DIM PINK | `#7a52b3` DIM VIOLET | `#3b64a8` DIM BLUE | `#2b7d76` DIM TEAL | `#4e8f4e` DIM GREEN | `#a8862a` DIM GOLD | `#5c6674` DIM GREY |

  These values were checked by script: luminance falls strictly down every column, and the lowest is 0.126 (DIM PINK). The doc comment should say that columns are hue families with neighbours merged so that ≥ 32 px swatches fit a 360 px phone, and that amber `#ffb454` and white are deliberately absent (selection signal; vanishes on `streets`).
- [ ] **Step 4: Run it, expect PASS.** Check the gate, then run the app:
  - The picker shows 4 rows × 8 columns, light at the top and dim at the bottom, with columns in the order above.
  - VESSELS FISHING rings TEAL, SATELLITES LEO rings ICE, and every default row rings a swatch.
  - A user value not in the grid (e.g. dim amber `#c27a2e`) rings nothing, and its hex shows in the field.
  - Hover titles read e.g. `DEEP TEAL #14A899`.
  - At 360×740 phone emulation there is no overflow.
- [ ] **Step 5: Commit**: `git add apps/web/src/app/swatches.ts apps/web/src/app/swatches.test.ts` then `git commit -m "feat(web): rebuild the swatch grid as hue columns by lightness"`

---

## Part 2: Globe navigation

Five HUD buttons (compass, zoom +, zoom −, home, locate me) and the keys `0` / `R`. The HUD only calls `requestCamera(command)` in a non-React `core/ui` store. `app/globe/cameraCommands` passes each command to new `CameraRig` methods, and for home / locate it releases the follow lock through `useFollow` first. The frame loop publishes the camera heading to a store only on a change of 1° or more, and the compass reads that store.

Builds on Part 4 (`core/ui/transport.ts` replaced `transportVisible` in App.tsx, CompactHud.tsx and globeKeys.ts) and Part 3 (CompactHud's picture button and sheet). This part does not touch those edits.

**Specialist and risk path.** Tasks 2.2, 2.3 and 2.4 change `CameraRig`, `createViewer` and the frame loop's camera read. Dispatch `@cesium-engine` (opus) to implement or review them, after the owner confirms the risk-path edit. Task 2.8 runs against its checklist (leaks, per-frame allocation, snap-back, rebuild). Part 4 Task 4.2 already added lines to `frameLoop.ts`: anchor the heading publish on `rig.update(dt)` by content, not by line number.

---

### Task 2.1: Camera command + heading store (`core/ui/cameraStore.ts`)

**Files:**
- Create: `apps/web/src/core/ui/cameraStore.ts`
- Test: `apps/web/src/core/ui/cameraStore.test.ts`

**Interfaces:**
- Consumes: `create` from `zustand`
- Produces:
  - `type CameraCommand = { kind: 'home' } | { kind: 'level' } | { kind: 'zoom'; direction: 1 | -1 } | { kind: 'flyTo'; lonDeg: number; latDeg: number; heightM: number }`
  - `requestCamera(command: CameraCommand): void`. It calls the bound handler once, synchronously. With no handler bound the command is dropped and never stored or replayed.
  - `bindCameraHandler(handler: (command: CameraCommand) => void): () => void`. There is one slot: binding replaces any previous handler. The returned unbind clears the slot only if it still holds *this* handler, so an old globe's late teardown after a context-loss rebuild cannot unbind the new globe.
  - `HEADING_STEP_DEG = 1`, `headingMoved(prevDeg: number, nextDeg: number): boolean`
  - `useCameraHeading` (zustand, state `{ headingDeg: number }`, initial 0), `publishHeading(headingDeg: number): void`. It sets the store only when `headingMoved(current, next)`. Otherwise it does nothing, so there is no `set` and no allocation.

- [ ] **Step 1: Write the failing test**
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindCameraHandler, headingMoved, publishHeading, requestCamera, useCameraHeading } from './cameraStore'

let unbind: (() => void) | null = null
afterEach(() => { unbind?.(); unbind = null })

describe('camera commands', () => {
  it('hands each request to the bound handler exactly once, in order', () => {
    const handler = vi.fn()
    unbind = bindCameraHandler(handler)
    requestCamera({ kind: 'zoom', direction: 1 })
    requestCamera({ kind: 'home' })
    expect(handler.mock.calls).toEqual([[{ kind: 'zoom', direction: 1 }], [{ kind: 'home' }]])
  })
  it('drops a request while no globe is bound and never replays it', () => {
    requestCamera({ kind: 'home' })
    const handler = vi.fn()
    unbind = bindCameraHandler(handler)
    expect(handler).not.toHaveBeenCalled()
  })
  it('stops delivering after unbind', () => {
    const handler = vi.fn()
    bindCameraHandler(handler)()
    requestCamera({ kind: 'level' })
    expect(handler).not.toHaveBeenCalled()
  })
  it('a newer binding replaces the old one; the stale unbind leaves it bound', () => {
    const old = vi.fn(), next = vi.fn()
    const unbindOld = bindCameraHandler(old)
    unbind = bindCameraHandler(next)
    unbindOld()
    requestCamera({ kind: 'level' })
    expect(old).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('headingMoved', () => {
  it('is true from a 1° change, measured across north too', () => {
    expect(headingMoved(0, 0.99)).toBe(false)
    expect(headingMoved(0, 1)).toBe(true)
    expect(headingMoved(10, 9)).toBe(true)
    expect(headingMoved(359.6, 0.3)).toBe(false) // 0.7° across north
    expect(headingMoved(359.5, 0.6)).toBe(true)  // 1.1° across north
    expect(headingMoved(0.4, 359.5)).toBe(false)
    expect(headingMoved(0, 360)).toBe(false)
    expect(headingMoved(90, 270)).toBe(true)
  })
})

describe('publishHeading', () => {
  beforeEach(() => useCameraHeading.setState({ headingDeg: 0 }))
  it('sets the store only when the heading moved at least 1°', () => {
    let sets = 0
    const unsub = useCameraHeading.subscribe(() => { sets++ })
    publishHeading(0.5)
    expect(sets).toBe(0)
    publishHeading(1.2)
    expect(useCameraHeading.getState().headingDeg).toBe(1.2)
    publishHeading(1.9)
    expect(sets).toBe(1)
    publishHeading(359.9) // 1.3° back across north
    expect(sets).toBe(2)
    expect(useCameraHeading.getState().headingDeg).toBe(359.9)
    unsub()
  })
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- cameraStore`. It fails because `./cameraStore` cannot be resolved.
- [ ] **Step 3: Implement** the store in `apps/web/src/core/ui/cameraStore.ts`. Commands use a plain module-level handler slot, not zustand state: a command is an event, not state, and a stored command would replay into a rebuilt globe. The wrap-safe distance is `Math.abs(((((next - prev) % 360) + 540) % 360) - 180) >= HEADING_STEP_DEG`. Put a doc comment on top saying that the HUD and globeKeys request commands and that `app/globe/cameraCommands` is the only handler.
  Then add `camera` to the `core/ui` store lists in `docs/ARCHITECTURE.md:16` and `AGENTS.md:22`, next to Part 3's "legend folds" (load `writing-instructions` first).
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/core/ui/cameraStore.ts apps/web/src/core/ui/cameraStore.test.ts docs/ARCHITECTURE.md AGENTS.md` then `git commit -m "feat(web): add camera command and heading store"`

---

### Task 2.2: `CameraRig.zoomStep` (allocation-free impulse). RISK PATH: owner confirms before the edit

**Files:**
- Modify: `apps/web/src/core/engine/CameraRig.ts:16-20` (constants), `:53-59` (fields), `:154-214` (`update`), `:216-219` (`dispose`)
- Test: `apps/web/src/core/engine/CameraRig.test.ts:10-23` (add `globe: { ellipsoid: Ellipsoid.WGS84 }` to the fake scene in `makeRig`, because free-camera distance reads `scene.globe.ellipsoid`) and a new `describe`

**Interfaces:**
- Produces: `CameraRig.zoomStep(direction: 1 | -1): void`. `1` = in (halves the distance), `-1` = out (doubles it), each over `ZOOM_STEP_SECONDS = 0.3` (module constant, not exported).
- Behaviour:
  - It calls `camera.cancelFlight()` first. A running follow fly-in then engages the lock synchronously through its `cancel: engage` callback (TweenCollection.remove calls `tween.cancel()`), so the step zooms the lock.
  - A tap in the same direction while a step is still pending adds another 0.3 s, so two quick taps give a quarter of the distance.
  - A tap in the opposite direction replaces the rest of the pending step.
  - While following, zoom-in stops at `MIN_FOLLOW_RANGE_M`.
- Refactor: extract the existing Q/E distance expression (`:204-209`) into a private `_distance(): number`, used by both Q/E and the impulse. Q/E behaviour is unchanged.

- [ ] **Step 1: Write the failing test** (add `vi`, `Ellipsoid` and `Math as CesiumMath` to the imports)
```ts
const heightOf = (camera: Camera) => Ellipsoid.WGS84.cartesianToCartographic(camera.positionWC).height
const frames = (rig: CameraRig, n: number, dtMs: number) => { for (let i = 0; i < n; i++) rig.update(dtMs) }

describe('CameraRig zoomStep', () => {
  it('one tap halves / doubles the free camera height over ~0.3 s, at any frame rate', () => {
    for (const [dtMs, n] of [[16, 40], [100, 5]] as const) {
      const { rig, camera } = makeRig()
      camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
      rig.zoomStep(1)
      frames(rig, n, dtMs)
      expect(heightOf(camera) / 4e6).toBeCloseTo(1, 3)
    }
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    rig.zoomStep(-1)
    frames(rig, 40, 16)
    expect(heightOf(camera) / 16e6).toBeCloseTo(1, 3)
  })
  it('two quick taps stack; an opposite tap replaces the rest', () => {
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    rig.zoomStep(1); rig.zoomStep(1)
    frames(rig, 60, 16)
    expect(heightOf(camera) / 2e6).toBeCloseTo(1, 3)
    rig.zoomStep(1); rig.zoomStep(-1)
    frames(rig, 40, 16)
    expect(heightOf(camera) / 4e6).toBeCloseTo(1, 3)
  })
  it('zooms the follow range while locked, never under 2 km', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    rig.zoomStep(1)
    frames(rig, 40, 16)
    expect(view(camera, target).range / 750_000).toBeCloseTo(1, 3)
    expect(rig.isFollowing()).toBe(true)
    rig.dispose()
  })
  it('never zooms a locked camera under 2 km', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 3_000)
    ready = true
    rig.update(16)
    rig.zoomStep(1); rig.zoomStep(1); rig.zoomStep(1)
    frames(rig, 80, 16)
    expect(view(camera, target).range).toBeCloseTo(2_000, 0)
    expect(rig.isFollowing()).toBe(true)
    rig.dispose()
  })
})
```
A target that resolves at once would start a real flight, which the fake scene cannot run; hence the `ready` trick in both tests.
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- CameraRig`. It fails with `rig.zoomStep is not a function`. The two existing follow-lock tests stay green.
- [ ] **Step 3: Implement `zoomStep(direction: 1 | -1): void` in `CameraRig.ts`.** Fields: `private _zoomDir: 1 | -1 = 1` and `private _zoomLeftS = 0`. In `update()`, place the impulse right after the follow-frame block and **before** `if (this._pressed.size === 0) return`. It uses exact exponential steps so the result is the same at any frame rate:
```ts
const ZOOM_RATE = Math.LN2 / ZOOM_STEP_SECONDS // per second
if (this._zoomLeftS > 0) {
  const s = Math.min(dt, this._zoomLeftS)
  this._zoomLeftS -= s
  const d = this._distance()
  if (this._zoomDir === 1) {
    const floor = this._getTarget !== null ? MIN_FOLLOW_RANGE_M : 0
    camera.zoomIn(Math.min(d * (1 - Math.exp(-ZOOM_RATE * s)), Math.max(0, d - floor)))
  } else camera.zoomOut(d * (Math.exp(ZOOM_RATE * s) - 1))
}
```
`dispose()` also sets `_zoomLeftS = 0`. Numbers only, so there is no allocation. `_distance` keeps reusing `scratchCartographic`.
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/core/engine/CameraRig.ts apps/web/src/core/engine/CameraRig.test.ts` then `git commit -m "feat(web): add a smooth zoom step to the camera rig"`

---

### Task 2.3: `CameraRig` flights (`HOME_VIEW`, `flyTo`, `flyHome`, `levelNorth`). RISK PATH: owner confirms before the edit

**Files:**
- Modify: `apps/web/src/core/engine/createViewer.ts:185-188` (export the constant above `createOrbitalViewer`, `:62`, and use it in the `setView`)
- Modify: `apps/web/src/core/engine/CameraRig.ts:1-13, 35-41` (imports `IntersectionTests`, `Ray`; constants; scratches) and new methods
- Modify: `apps/web/src/core/engine/CLAUDE.md:2,12,20,24`
- Test: `apps/web/src/core/engine/CameraRig.test.ts`

**Interfaces:**
- Consumes: `_zoomLeftS` from Task 2.2
- Produces:
  - `export const HOME_VIEW = { lonDeg: 15, latDeg: 35, heightM: 28_000_000 } as const` in `createViewer.ts`. The first-visit `setView` becomes `Cartesian3.fromDegrees(HOME_VIEW.lonDeg, HOME_VIEW.latDeg, HOME_VIEW.heightM)`, with its default orientation (north-up, straight down) unchanged.
  - `CameraRig.flyTo(lonDeg: number, latDeg: number, heightM: number): void`. It flies `FLIGHT_SECONDS = 1.5` to that point with orientation `{ heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }`.
  - `CameraRig.flyHome(): void`, which is `flyTo(HOME_VIEW.lonDeg, HOME_VIEW.latDeg, HOME_VIEW.heightM)`.
  - `CameraRig.levelNorth(): void`
- Behaviour per the spec table:

| | Free camera | While follow-locked |
|---|---|---|
| `flyTo` / `flyHome` | Calls `_stopMotion()` (`_zoomLeftS = 0`, then `camera.cancelFlight()`), then flies. | Calls `this.unfollow()` first. This is a safety net: the wiring (Task 2.4) has already released the lock through `useFollow`, so it is a no-op there. |
| `levelNorth` | Shoots the ray (`positionWC`, `directionWC`) at `scene.globe.ellipsoid` with `IntersectionTests.rayEllipsoid`. The hit is at `start > 0 ? start : stop`, the same rule as `Camera.pickEllipsoid`. It flies `LEVEL_SECONDS = 0.6` to that point's lon/lat at **height = camera-to-point distance**, so the range is kept, as Google Earth's reset-tilt does. On a miss (looking at space) it uses the camera's own lon/lat at its height. | Recomputes ENU at `this._getTarget()` into `scratchTransform` and calls `camera.lookAtTransform(scratchTransform, scratchLevel)`. `scratchLevel` is a module-scope `HeadingPitchRange(0, -PI/2, range)` with `range = Cartesian3.magnitude(camera.position)` (target-local). It then sets `_needsInitialOffset = false`. If the target is null it does nothing. The lock stays, and `update()` carries the level pose as the frame moves. |

  `levelNorth` must call `_stopMotion()` **before** it checks `this._getTarget !== null`. A cancelled follow fly-in engages the lock inside `cancelFlight()`.
- Never pass a scratch as `destination`. Cesium's flight closes over the reference for its whole duration (`CameraFlightPath.js` `createUpdate3D(scene, duration, destination, …)`). Build a fresh `Cartesian3.fromDegrees` / `fromRadians` per call (one per tap, not per frame). Ray and centre point use module-scope scratches (`new Ray()`, `new Cartesian3()`).

- [ ] **Step 1: Write the failing test**
```ts
import { HOME_VIEW } from './createViewer'
const NORTH_DOWN = { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 }
const stubFlights = (camera: Camera) => vi.spyOn(camera, 'flyTo').mockImplementation(() => {})
type FlyOptions = { destination: Cartesian3; orientation: unknown; duration: number }
const deg = (p: Cartesian3) => {
  const c = Ellipsoid.WGS84.cartesianToCartographic(p)
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), h: c.height }
}

describe('CameraRig navigation flights', () => {
  it('HOME_VIEW is the first-visit view', () => {
    expect(HOME_VIEW).toEqual({ lonDeg: 15, latDeg: 35, heightM: 28_000_000 })
  })
  it('flyHome / flyTo fly north-up, looking straight down, in 1.5 s', () => {
    const { rig, camera } = makeRig()
    const fly = stubFlights(camera)
    rig.flyHome()
    rig.flyTo(14.42, 50.08, 500_000)
    const [home, here] = fly.mock.calls.map(([o]) => o as FlyOptions)
    expect(Cartesian3.equalsEpsilon(home.destination, Cartesian3.fromDegrees(15, 35, 28e6), 0, 1)).toBe(true)
    expect(Cartesian3.equalsEpsilon(here.destination, Cartesian3.fromDegrees(14.42, 50.08, 5e5), 0, 1)).toBe(true)
    expect(home.orientation).toEqual(NORTH_DOWN)
    expect(here.duration).toBe(1.5)
  })
  it('a flight drops a pending zoom step and a follow lock', () => {
    const { rig, camera } = makeRig()
    camera.setView({ destination: Cartesian3.fromDegrees(15, 35, 8e6) })
    stubFlights(camera)
    rig.zoomStep(1)
    rig.flyHome()
    for (let i = 0; i < 40; i++) rig.update(16)
    expect(deg(camera.positionWC).h).toBeCloseTo(8e6, -1)
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    rig.flyTo(0, 0, 1e6)
    expect(rig.isFollowing()).toBe(false)
    expect(Matrix4.equals(camera.transform, Matrix4.IDENTITY)).toBe(true)
  })
  it('levelNorth (free) flies over the screen-centre point at the same distance', () => {
    const cases = [
      // straight down, rotated 30°: centre is the sub-camera point
      { at: [10, 40, 5e6], headingDeg: 30, pitchDeg: -90, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 2); expect(Math.abs(d.lat - 40)).toBeLessThan(0.1); expect(d.h).toBeCloseTo(5e6, -4) } },
      // tilted 45° north: centre lies ~23° north, ~3 556 km away
      { at: [10, 40, 2e6], headingDeg: 0, pitchDeg: -45, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 2); expect(d.lat).toBeGreaterThan(60); expect(d.h).toBeCloseTo(3.556e6, -4) } },
      // looking at space: falls back to the camera's own spot and height
      { at: [10, 40, 2e7], headingDeg: 0, pitchDeg: 0, check: (d: ReturnType<typeof deg>) => {
        expect(d.lon).toBeCloseTo(10, 4); expect(d.lat).toBeCloseTo(40, 4); expect(d.h).toBeCloseTo(2e7, -1) } },
    ]
    for (const c of cases) {
      const { rig, camera } = makeRig()
      camera.setView({ destination: Cartesian3.fromDegrees(c.at[0], c.at[1], c.at[2]),
        orientation: { heading: CesiumMath.toRadians(c.headingDeg), pitch: CesiumMath.toRadians(c.pitchDeg), roll: 0 } })
      const fly = stubFlights(camera)
      rig.levelNorth()
      const o = fly.mock.calls[0][0] as FlyOptions
      c.check(deg(o.destination))
      expect(o.orientation).toEqual(NORTH_DOWN)
      expect(o.duration).toBe(0.6)
    }
  })
  it('levelNorth (locked) levels around the target, keeps lock and range, holds as the target moves', () => {
    const { rig, camera } = makeRig()
    const target = Cartesian3.fromDegrees(14, 50, 400_000)
    let ready = false
    rig.follow(() => (ready ? target : null), 1_500_000)
    ready = true
    rig.update(16)
    camera.rotateRight(0.5)
    rig.levelNorth()
    const level = () => {
      const h = CesiumMath.toDegrees(camera.heading)
      expect(Math.min(h, 360 - h)).toBeLessThan(0.1)
      expect(Math.abs(CesiumMath.toDegrees(camera.pitch) + 90)).toBeLessThan(0.1)
      expect(view(camera, target).fwd).toBeCloseTo(1, 6)
      expect(view(camera, target).range).toBeCloseTo(1_500_000, -1)
    }
    level()
    expect(rig.isFollowing()).toBe(true)
    Cartesian3.fromDegrees(20, 45, 400_000, undefined, target)
    rig.update(16)
    level()
    rig.dispose()
  })
})
```
The 0.1° tolerances are measured, not guessed. Cesium's ENU frame uses `geodeticSurfaceNormal` at an off-surface point, so a locked camera that is straight down reads pitch −89.97°, and a straight-down `setView` at 5 000 km hits latitude 39.93°.
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- CameraRig`. It fails because `HOME_VIEW` is not exported and `rig.flyHome` is not a function.
- [ ] **Step 3: Implement** `flyTo` / `flyHome` / `levelNorth` and a private `_fly(destination: Cartesian3, seconds: number)` that builds the orientation object per call. Each method returns early on `viewer.isDestroyed()`.
  - `core/engine/CLAUDE.md` is at 24 lines, the limit, so **fold** the new facts into existing lines and do not add any:
    - line 2: "the keyboard/follow `CameraRig`" becomes "the keyboard/follow/navigation `CameraRig` (zoom impulse, level north, flights to `HOME_VIEW` or a point)";
    - line 12: add "(its zoom impulse included)" after `CameraRig.update`;
    - line 20: append "Flights: Cesium closes over the `destination` it is handed (`CameraFlightPath` `createUpdate3D`), so `_fly` builds a fresh Cartesian3, never a scratch; a flight drops the follow frame, so a locked `levelNorth` re-poses inside the frame instead of flying.";
    - line 24: after "`-- CameraRig` drives a real `Camera` on a fake scene" add "(`camera.flyTo` stubbed: flights need `scene.tweens`)".
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/core/engine/createViewer.ts apps/web/src/core/engine/CameraRig.ts apps/web/src/core/engine/CameraRig.test.ts apps/web/src/core/engine/CLAUDE.md` then `git commit -m "feat(web): add home, level and fly-to flights to the camera rig"`

---

### Task 2.4: Globe wiring: commands to the rig, heading publish

**Files:**
- Create: `apps/web/src/app/globe/cameraCommands.ts`
- Modify: `apps/web/src/app/globe/createGlobe.ts:23` (import) and `:152` (after `teardown.push(bindGlobeKeys(rig))`)
- Modify: `apps/web/src/app/globe/frameLoop.ts:1-5` (imports `Math as CesiumMath` from `cesium`, `publishHeading`) and `:87` (after `rig.update(dt)`)
- Test: `apps/web/src/app/globe/cameraCommands.test.ts`

**Interfaces:**
- Consumes: `CameraCommand`, `bindCameraHandler`, `publishHeading` (2.1); `CameraRig.flyHome/flyTo/zoomStep/levelNorth` (2.2, 2.3); `useFollow`; `GlobeFollow` (its subscription calls `rig.unfollow()` synchronously when `following` turns false)
- Produces:
  - `type NavRig = Pick<CameraRig, 'flyHome' | 'flyTo' | 'zoomStep' | 'levelNorth'>`
  - `runCameraCommand(rig: NavRig, command: CameraCommand): void`
    - `home` and `flyTo`: if `useFollow.getState().following`, call `setFollowing(false)` **first**, then fly. The other order would let `unfollow()`'s `cancelFlight()` kill the new flight.
    - `level` → `levelNorth()` and `zoom` → `zoomStep(direction)`; both leave the lock alone.
  - `bindCameraCommands(rig: NavRig): () => void`, which is `bindCameraHandler((c) => runCameraCommand(rig, c))`.
- createGlobe: `teardown.push(bindCameraCommands(rig))` goes right after the `bindGlobeKeys` line. `GlobeFollow` exists by then, and teardown runs newest-first, so the handler is unbound before the follow and the rig are disposed.
- frameLoop: `publishHeading(CesiumMath.toDegrees(viewer.camera.heading))` right after `rig.update(dt)`. `Camera#heading` uses Cesium's own scratch matrices (`Camera.js:993-1011`), so this is a number compare per frame and a store set only on a move of 1° or more.

- [ ] **Step 1: Write the failing test**
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))
import { requestCamera } from '../../core/ui/cameraStore'
import { useFollow } from '../../core/ui/followStore'
import { bindCameraCommands, runCameraCommand } from './cameraCommands'
import { GlobeFollow } from './follow'

function setup(following: boolean) {
  useFollow.setState({ following }) // set BEFORE GlobeFollow subscribes: no engage fires
  const log: string[] = []
  const rig = {
    follow: vi.fn(),
    unfollow: () => { log.push('unfollow') },
    flyHome: () => { log.push('flyHome') },
    flyTo: (lon: number, lat: number, h: number) => { log.push(`flyTo ${lon} ${lat} ${h}`) },
    zoomStep: (d: 1 | -1) => { log.push(`zoom ${d}`) },
    levelNorth: () => { log.push('level') },
  }
  const decal = () => ({ setPose: vi.fn(), hide: vi.fn() })
  const follow = new GlobeFollow(rig, { active: false }, decal(), decal())
  return { rig, log, follow }
}

describe('camera commands', () => {
  it('HOME releases the lock before it flies', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'home' })
    expect(log).toEqual(['unfollow', 'flyHome'])
    expect(useFollow.getState().following).toBe(false)
    follow.dispose()
  })
  it('locate (flyTo) releases the lock before it flies', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'flyTo', lonDeg: 14.42, latDeg: 50.08, heightM: 500_000 })
    expect(log).toEqual(['unfollow', 'flyTo 14.42 50.08 500000'])
    follow.dispose()
  })
  it('compass and zoom keep the lock', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'level' })
    runCameraCommand(rig, { kind: 'zoom', direction: 1 })
    runCameraCommand(rig, { kind: 'zoom', direction: -1 })
    expect(log).toEqual(['level', 'zoom 1', 'zoom -1'])
    expect(useFollow.getState().following).toBe(true)
    follow.dispose()
  })
  it('a free camera flies HOME without touching the lock', () => {
    const { rig, log, follow } = setup(false)
    runCameraCommand(rig, { kind: 'home' })
    expect(log).toEqual(['flyHome'])
    follow.dispose()
  })
  it('bindCameraCommands forwards requests until unbound', () => {
    const { rig, log, follow } = setup(false)
    const unbind = bindCameraCommands(rig)
    requestCamera({ kind: 'home' })
    unbind()
    requestCamera({ kind: 'level' })
    expect(log).toEqual(['flyHome'])
    follow.dispose()
  })
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- cameraCommands`. It fails because `./cameraCommands` cannot be resolved.
- [ ] **Step 3: Implement** `runCameraCommand` (an exhaustive `switch` on `command.kind`) and `bindCameraCommands` in `cameraCommands.ts`. Then make the two one-line wiring edits in `createGlobe.ts` and `frameLoop.ts`. The frameLoop doc line "Allocates nothing per frame." stays true; leave it.
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/app/globe/cameraCommands.ts apps/web/src/app/globe/cameraCommands.test.ts apps/web/src/app/globe/createGlobe.ts apps/web/src/app/globe/frameLoop.ts` then `git commit -m "feat(web): wire camera commands and heading into the globe"`

---

### Task 2.5: Keys `0` (home) and `R` (north-up + level)

**Files:**
- Modify: `apps/web/src/app/globe/globeKeys.ts:1-8` (import `requestCamera`), and the `switch` at `:51-94` (two cases; Part 4's `timeControlsActive` edit is untouched)
- Modify: `apps/web/src/app/HelpOverlay.tsx:39` (CAMERA section, after `['Q / E', 'Zoom in / out']`)
- Modify: `docs/CONTROLS.md:49` (Camera key table, after the `Q / E` row)
- Test: `apps/web/src/app/globe/globeKeys.test.ts`

**Interfaces:**
- Consumes: `requestCamera`, `bindCameraHandler`, `CameraCommand` (2.1)
- Produces: `case 'Digit0': requestCamera({ kind: 'home' })` and `case 'KeyR': requestCamera({ kind: 'level' })`. Both sit after the existing repeat/modifier guard, so Ctrl/Cmd+R still reloads and a held key does not fire again. They are **not** gated on the HUD being visible: camera keys work while the HUD is hidden, like W A S D. No `preventDefault`, because neither key has a browser default.

- [ ] **Step 1: Write the failing test** (add to `globeKeys.test.ts`)
```ts
import { bindCameraHandler, type CameraCommand } from '../../core/ui/cameraStore'

it('0 flies home and R levels north-up; Ctrl+R, repeats and typing pass', () => {
  const { onKeyDown } = setup()
  const commands: CameraCommand[] = []
  const unbind = bindCameraHandler((c) => { commands.push(c) })
  onKeyDown(key('Digit0'))
  onKeyDown(key('KeyR'))
  const reload = key('KeyR', { ctrlKey: true })
  onKeyDown(reload)
  onKeyDown(key('Digit0', { repeat: true }))
  onKeyDown(key('KeyR', { target: { tagName: 'INPUT' } as unknown as EventTarget }))
  unbind()
  expect(commands).toEqual([{ kind: 'home' }, { kind: 'level' }])
  expect(reload.preventDefault).not.toHaveBeenCalled()
})

it('0 and R still work while the HUD is hidden', () => {
  const { onKeyDown } = setup()
  useHud.setState({ hidden: true })
  const commands: CameraCommand[] = []
  const unbind = bindCameraHandler((c) => { commands.push(c) })
  onKeyDown(key('Digit0'))
  unbind()
  expect(commands).toEqual([{ kind: 'home' }])
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- globeKeys`. `commands` comes back as `[]`.
- [ ] **Step 3: Implement** the two cases. HelpOverlay CAMERA rows: `['0', 'Whole Earth view (HOME button)']` and `['R', 'North up, look straight down (compass button)']`. CONTROLS.md rows: `| 0 | Fly to the whole-Earth view (HOME button); releases a follow-lock |` and `| R | Turn north-up and look straight down (compass button); keeps a follow-lock |`.
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/app/globe/globeKeys.ts apps/web/src/app/globe/globeKeys.test.ts apps/web/src/app/HelpOverlay.tsx docs/CONTROLS.md` then `git commit -m "feat(web): add 0 home and r level keys"`

---

### Task 2.6: Geolocation helper (`core/ui/geolocation.ts`)

**Files:**
- Create: `apps/web/src/core/ui/geolocation.ts`
- Test: `apps/web/src/core/ui/geolocation.test.ts`

**Interfaces:**
- Produces:
  - `type LocateError = 'denied' | 'unavailable' | 'timeout' | 'unsupported'`
  - `type LocateResult = { ok: true; latDeg: number; lonDeg: number; altitudeM: number | null } | { ok: false; error: LocateError }`
  - `type GeoSource = Pick<Geolocation, 'getCurrentPosition'>`
  - `LOCATE_OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }`. A coarse fix is enough for a 500 km view.
  - `locateDevice(geo: GeoSource | undefined): Promise<LocateResult>`. The parameter is required with no default, so tests can pass `undefined`. Callers pass `'geolocation' in navigator ? navigator.geolocation : undefined`. Error code 1 → `denied`, 3 → `timeout`, anything else → `unavailable`. Use numeric codes, because the `GeolocationPositionError` constants do not exist in Node.
  - `locateErrorLabel(e: LocateError): string`: `denied` → `LOCATION DENIED`, `unavailable` → `LOCATION UNAVAILABLE`, `timeout` → `LOCATION TIMED OUT`, `unsupported` → `NO LOCATION IN THIS BROWSER`.
- Not done here: `features/passes/PassesPanel.tsx:137-158` keeps its own GPS code. Part 5 rewrites that observer line and may adopt `locateDevice` there. No slice imports another slice; the helper lives in `core/ui`.

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it, vi } from 'vitest'
import { locateDevice, locateErrorLabel, LOCATE_OPTIONS } from './geolocation'

function geo(outcome: { pos?: GeolocationPosition; code?: number }) {
  return {
    getCurrentPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
      if (outcome.pos) ok(outcome.pos)
      else fail?.({ code: outcome.code } as GeolocationPositionError)
    }),
  }
}
const fix = { coords: { latitude: 50.0755, longitude: 14.4378, altitude: null } } as unknown as GeolocationPosition

describe('locateDevice', () => {
  it('resolves the fix and asks with the coarse options', async () => {
    const g = geo({ pos: fix })
    await expect(locateDevice(g)).resolves.toEqual({ ok: true, latDeg: 50.0755, lonDeg: 14.4378, altitudeM: null })
    expect(g.getCurrentPosition.mock.calls[0][2]).toEqual(LOCATE_OPTIONS)
    expect(LOCATE_OPTIONS).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 })
  })
  it('maps error codes 1 / 2 / 3 to denied / unavailable / timeout', async () => {
    await expect(locateDevice(geo({ code: 1 }))).resolves.toEqual({ ok: false, error: 'denied' })
    await expect(locateDevice(geo({ code: 2 }))).resolves.toEqual({ ok: false, error: 'unavailable' })
    await expect(locateDevice(geo({ code: 3 }))).resolves.toEqual({ ok: false, error: 'timeout' })
  })
  it('reports a browser without geolocation as unsupported', async () => {
    await expect(locateDevice(undefined)).resolves.toEqual({ ok: false, error: 'unsupported' })
  })
  it('labels every error for the HUD', () => {
    expect(locateErrorLabel('denied')).toBe('LOCATION DENIED')
    expect(locateErrorLabel('unavailable')).toBe('LOCATION UNAVAILABLE')
    expect(locateErrorLabel('timeout')).toBe('LOCATION TIMED OUT')
    expect(locateErrorLabel('unsupported')).toBe('NO LOCATION IN THIS BROWSER')
  })
})
```
- [ ] **Step 2: Run it, expect FAIL**: `npm test -w apps/web -- geolocation`. It fails because `./geolocation` cannot be resolved.
- [ ] **Step 3: Implement** both functions. `locateDevice` wraps `getCurrentPosition` in a Promise that always resolves and never rejects.
- [ ] **Step 4: Run it, expect PASS**
- [ ] **Step 5: Commit**: `git add apps/web/src/core/ui/geolocation.ts apps/web/src/core/ui/geolocation.test.ts` then `git commit -m "feat(web): add device geolocation helper"`

---

### Task 2.7: `NavControls` HUD component, `nav.css`, placement, docs

**Files:**
- Create: `apps/web/src/app/NavControls.tsx`, `apps/web/src/styles/nav.css`
- Modify: `apps/web/src/styles/index.css:20-21` (header note) and `:47` (add `@import './nav.css';` after `./dock.css`)
- Modify: `apps/web/src/App.tsx:70-72`. Desktop branch: `<NavControls />` goes **immediately after** the `<div className="right-stack">…</div>`, because the CSS sibling rule needs that DOM order. Part 4's `useTransportVisible` lines are untouched.
- Modify: `apps/web/src/app/CompactHud.tsx:118-120`. The first child of `.cluster-stack` becomes `{openSheet === null && <NavControls />}`, before the `SelectionChip` line, so the controls are hidden while any sheet is open. Part 3's picture button and sheet are untouched.
- Modify: `apps/web/src/app/HelpOverlay.tsx:15` (TOUCH section, after `TWO-FINGER DRAG`) and `docs/CONTROLS.md`.

**Interfaces:**
- Consumes: `requestCamera`, `useCameraHeading` (2.1); `locateDevice`, `locateErrorLabel` (2.6)
- Produces: `export function NavControls()`. Export only the component, because `react-refresh/only-export-components` is on. Keep `LOCATE_HEIGHT_M = 500_000` and `LOCATE_MESSAGE_MS = 4_000` module-private.
- Structure: `<div className="nav-controls" role="group" aria-label="Globe navigation">` holding five `button.hud-button.nav-button`, in this order:

| Button | aria-label | title | Sends |
|---|---|---|---|
| Compass (inner `Compass` component) | `North up` | `North up, look straight down (R)` | `{ kind: 'level' }` |
| Zoom in | `Zoom in` | `Zoom in (Q)` | `{ kind: 'zoom', direction: 1 }` |
| Zoom out | `Zoom out` | `Zoom out (E)` | `{ kind: 'zoom', direction: -1 }` |
| Home | `Whole Earth` | `Whole Earth view (0)` | `{ kind: 'home' }` |
| Locate | `Fly to my location` | `Fly to my location` | inside `span.nav-locate` with `span.nav-message[role=status]` |

  - **Compass:** `Compass` is the only subscriber to `useCameraHeading`, so a heading publish re-renders one button. The needle SVG rotates with inline `style={{ transform: \`rotate(${-headingDeg}deg)\` }}`: screen north is minus the camera heading. No CSS transition.
  - **Locate flow:**
    - While a request is pending: `aria-busy`, taps are ignored, and the message reads `LOCATING…`.
    - On `ok`: clear the message, then `requestCamera({ kind: 'flyTo', lonDeg, latDeg, heightM: LOCATE_HEIGHT_M })`. Fly even if the component unmounted meanwhile; the user asked.
    - On error: show `locateErrorLabel(error)` with `.is-error` for 4 s. Clear the timer in an unmount cleanup.
  - **Icons:** inline SVG with `currentColor`, the same as `ShowControlsButton`. `@hud-designer` picks the glyphs. The compass north tip uses `var(--alert)`.
- **Placement** (the decisions; the skins are `@hud-designer`'s, using tokens only and no `tokens.css` edit; `--nav-size` is a component-local length):
```css
.nav-controls {
  --nav-size: 32px;
  position: absolute;                         /* desktop: under the mode tabs ... */
  top: calc(38px + var(--safe-top) + var(--tab-h) + var(--sp-2));
  right: calc(var(--sp-3) + var(--safe-right) + var(--w-right) + var(--sp-2)); /* ... beside the right stack */
  display: flex; flex-direction: column; gap: 6px;
  pointer-events: none;                       /* only the buttons take taps */
}
.right-stack:empty ~ .nav-controls { right: calc(var(--sp-3) + var(--safe-right)); } /* no selection: on the edge */
.nav-controls > * { pointer-events: auto; }
.nav-button { width: var(--nav-size); height: var(--nav-size); min-width: 0; min-height: 0; padding: 0; display: grid; place-items: center; }
@media (pointer: coarse) { .nav-controls { --nav-size: var(--tap); } }
.is-compact .nav-controls { --nav-size: var(--tap); }
/* phone portrait (tall): column at the compact cluster's top-right, under the tabs */
@media (orientation: portrait) and (min-height: 601px) {
  .is-compact .nav-controls { top: 0; right: 0; width: auto; max-width: none; align-self: auto; }
}
/* landscape phone / short portrait: an in-flow row heading the cluster stack, right-aligned to the dock */
@media (orientation: landscape), (max-height: 600px) {
  .is-compact .nav-controls { position: static; flex-direction: row; justify-content: flex-end; }
}
```
  - Why: the absolute column resolves against `.compact-cluster` (`cluster.css:11-22`). In row mode the `.cluster-stack > *` width rules (`cluster.css:39-46, 67-69`) make the row as wide as the dock.
  - `.nav-message`: absolutely placed left of the locate button in column mode (`right: calc(100% + var(--sp-2))`) and above it in row mode; `pointer-events: none`; `:empty { display: none }`; `.is-error` coloured `var(--alert)`.
  - index.css header gets one line: "nav.css after controls-late.css: its square nav buttons override the touch padding".
- **Docs:**
  - HelpOverlay TOUCH row: `['COMPASS · + / − · HOME · LOCATE', 'Nav buttons: north-up + level, zoom, whole Earth, fly to your location']`.
  - CONTROLS.md: a new `## Globe navigation` section before `## Camera follow-lock` (`:73`). It holds the four-row table (control / key / tap does / while follow-locked), copying the spec table: compass `R` keeps the lock; + / − zoom the follow range; HOME `0` and LOCATE release the lock first. Then a placement paragraph, the four locate messages shown for ~4 s beside the button, and "keys 0 and R work while the controls are hidden".
  - The HIDE paragraph (`:92-94`) adds "navigation buttons" to the list of what HIDE takes off.

- [ ] **Step 1: Implement** the component, the CSS (`@hud-designer`, opus) and the four edits above.
- [ ] **Step 2: Run** (layout task, no unit test) `npm run dev` and check in Chrome DevTools (device toolbar; "Touch" emulation for the phone and iPad cases):
  - Desktop 1440×900, 1024×768 and 1180×820 with touch (an iPad in landscape is coarse and not compact). With no selection, the column sits at the right edge under the mode tabs. Pick the ISS (search `25544`): the column moves beside the right stack. It must never overlap the right stack, the mode tabs, the left rail or the transport bar. The right stack keeps its full `max-height`.
  - Phone portrait 412×915 and 360×640. The column sits top-right under the tabs. With a satellite picked (chip + transport bar showing) it must not overlap the chip, dock or transport. Open each sheet (picture, LAYERS, DETAILS): the controls are gone; close the sheet and they come back.
  - Phone landscape 915×412 and 667×375, and short portrait 320×568. The row heads the cluster, right-aligned with the dock, with no overlap, and is hidden while a sheet is open.
  - Touch emulation: every nav button computes to at least 44×44. HIDE / `U` hides the controls, and restore brings them back.
  - React DevTools "highlight updates": while you rotate with A/D, only the compass button flashes. A still camera re-renders nothing.
  - Sensors → Location:
    - "Berlin": LOCATE flies to Berlin at ~500 km, north-up.
    - "Location unavailable": `LOCATION UNAVAILABLE` beside the button for ~4 s.
    - Site settings → Location: Block: `LOCATION DENIED`.
- [ ] **Step 3: Gate**: `npm run lint && npm test` from the repo root.
- [ ] **Step 4: Screenshot** the desktop (with and without a selection), phone portrait and phone landscape for the PR.
- [ ] **Step 5: Commit**: `git add apps/web/src/app/NavControls.tsx apps/web/src/styles/nav.css apps/web/src/styles/index.css apps/web/src/App.tsx apps/web/src/app/CompactHud.tsx apps/web/src/app/HelpOverlay.tsx docs/CONTROLS.md` then `git commit -m "feat(web): add globe navigation controls to the hud"`

---

### Task 2.8: Engine run-and-watch verification (no code unless something bites)

The suite cannot see a leak or a snap-back (`CLAUDE.md` → *Verification*). Run `npm run dev` on desktop Chrome and do the following. `__opsViewer` is the dev-only console handle.

- [ ] **Step 1: Free camera.**
  - Tilt with Ctrl+drag and rotate, then tap the compass. The view turns north-up and straight down, the point that was at screen centre stays there, and the needle points up.
  - + and − each take ~0.3 s. Read `__opsViewer.camera.positionCartographic.height` before and after: half and double.
  - HOME and `0` fly 1.5 s to the whole Earth over Europe. Tapping + during a HOME flight stops the flight and plays the zoom.
- [ ] **Step 2: Follow-locked.**
  - ISS → `F` at ×60. The compass levels straight down on the ISS, and the button still reads LOCKED with the ISS centred for 30 s. + and − change the range and the lock stays.
  - HOME: the button reads FOLLOW and the flight lands at the whole Earth. The camera stays there for at least 10 s (**no snap-back**).
  - Repeat with LOCATE (emulated Berlin).
  - Press `F`, then within 1.2 s (during the fly-in) tap HOME: it lands home and reads FOLLOW. Press `F`, then within 1.2 s tap the compass: it locks and levels.
  - AIRSPACE: click an aircraft (auto-lock), then HOME. The lock is released, the aircraft stays selected, and nothing locks again on the next poll.
- [ ] **Step 3: Console** shows no errors or warnings during Steps 1–2.
- [ ] **Step 4: Heap.**
  - DevTools Memory: take snapshot A after boot settles.
  - Use the controls for 3–5 min: 50 or more taps across all five buttons, several HOME and LOCATE flights, and the follow lock on and off.
  - Collect garbage, take snapshot B and open the Comparison view. Tween and Camera counts, and other Cesium objects, must not grow, and there must be no detached `nav-controls` nodes.
  - The Performance monitor's JS heap stays flat while idle with the compass on screen.
- [ ] **Step 5: Rebuild.** (RISK PATH: the owner confirms before any `core/engine/CLAUDE.md` edit this step makes.) In the console run `__opsViewer.scene.context._gl.getExtension('WEBGL_lose_context').loseContext()`. After the rebuild, HOME and the compass still work: the new globe's handler is bound and the old one released. If any step bites, add a trap to `core/engine/CLAUDE.md` by folding it into an existing bullet (the file is at the 24-line limit). Then `git add apps/web/src/core/engine/CLAUDE.md` and `git commit -m "docs(web): record camera rig navigation trap"`.

---

## Part 5: Satellite detail: clearer, and finished

`lib/orbital` gets orbit facts read from the TLE and a Sun / Earth-shadow model. `predictPasses` adds rise and set azimuths and a naked-eye flag. The tracking slice pushes the orbit facts once per selection and SUNLIT at the existing ~5 Hz push. TelemetryPanel is regrouped into NOW / ORBIT, and PassesPanel into NEXT PASS OVER YOU with a countdown, a WATCH ▶ button and a one-line observer. No server, shared-schema or risk-path (`core/engine`, `workers`, `*propagat*`) file changes.

**Decisions this part fixes (the implementer cannot make them alone)**
- **Sun model: do NOT call satellite.js `sunPos`.** In 6.0.2, `sunPos(jday: number): { rsun: number[] /* AU */; rtasc; decl }` has a bug in `node_modules/satellite.js/lib/sun.js:45` (and `dist/satellite.es.js:3027`): `(357.5277233 + 35999.05034 * ttdb * deg2rad) % twoPi` converts only the rate term to radians, so the constant 357.53° is read as radians. Measured against Cesium's Sun it is 1.40° off at the fixture epoch, and it puts the ISS in shadow on 22 of 558 ten-second samples of an orbit that Cesium shows fully sunlit. It also allocates two objects per call. `lib/orbital` carries the same Vallado series with the mean anomaly converted correctly. That copy is 0.36–0.37° from Cesium, and that gap is the J2000→2026 precession that Cesium's no-EOP frame leaves out.
- **Shadow model: cylindrical umbra.** The Sun is treated as a point at infinity and the Earth as a sphere of SGP4's own radius `constants.earthRadius` = 6378.135 km.
  - The cost is one dot product and one compare, with no allocation.
  - A conical umbra/penumbra model would move the edge by about the penumbra crossing time: ~8 s for the ISS, ≲ 1 min of a ≤ 72 min eclipse at GEO. A boolean readout at 5 Hz and a flag decided on 30 s samples cannot resolve that.
  - The spec has no PENUMBRA state.
  - Measured against Cesium's ellipsoidal occluder: ≤ 2 of 558 samples disagree on a typical orbit, and 7 at the grazing beta-angle edge on day +1.
- **Frames and units.** The Sun and the shadow test work in ECI km, the frame SGP4 and the Sun series both produce. `SatStateEcef` gains `positionEciKm`, the raw SGP4 vector for the same instant, so no position is ever converted back from metres. Observer sun elevation goes through `gstime(jd)` → `eciToEcf` → `ecfToLookAngles(observerGd /* rad, km */)`, the same path as the pass look angles. It is geometric, with no refraction.
- **Perigee / apogee** = `satrec.a·R·(1 ∓ e) − R` with R = 6378.135 km, the published convention (above the equatorial radius). They go only into the ORBIT span's title. The span itself is `altitudeSpanKm`: the geodetic low–high over one SGP4 orbit, the same altitude NOW shows, so the live value always lies inside it (owner call 15; for the ISS fixture the mean-element figures are 415.7–424.8 km, the geodetic span 419.8–433.0 km).
- **Casing.** The HUD is all caps (`format.ts` returns `KM`, `MIN`, `D`), so the mockup's lowercase lines are read as wording, not casing. The strings in the tests below are the contract.
- **Every pass keeps a WATCH ▶ button, including the next one.** Today every row has →, and the mockup leaving it off the next row would drop the most-used jump.
- **Owners and gates.**
  - `lib/` tasks belong to `@orbital-mechanics`; the CSS and layout steps in 5.6 and 5.7 belong to `@hud-designer`.
  - The first write under `features/**` needs `frontend-slice-architecture` loaded (the hook denies it otherwise). Slice tests follow `frontend-testing`.
  - vitest does not type-check, but CI's `npm run build` does. After 5.2, 5.3 and 5.5, run `npx tsc -b apps/web`.
  - `tsconfig.app.json` sets lib to ES2022, so `Array.prototype.findLast` is not available.

### Task 5.1: Orbit facts from the TLE (`lib/orbital`)
**Files:**
- Modify: `apps/web/src/lib/orbital.ts:18-33` (imports and constants; new exports after `orbitalPeriodMinutes`, :134-137)
- Modify: `apps/web/src/lib/orbital.test.ts:3-14,37-38,48-51`
- Create: `apps/web/src/lib/orbital.crosscheck.test.ts`
- Test: `apps/web/src/lib/orbital.test.ts`, `apps/web/src/lib/orbital.crosscheck.test.ts`

**Interfaces:**
- Consumes: `SatRec.a` (semi-major axis, Earth radii, set by `sgp4init`), `SatRec.ecco`, `SatRec.jdsatepoch`; `constants.earthRadius` (named export `constants` of `satellite.js`).
- Produces:
  - `interface PerigeeApogee { perigeeKm: number; apogeeKm: number }`
  - `perigeeApogeeKm(satrec: SatRec): PerigeeApogee`
  - `altitudeSpanKm(satrec: SatRec, startMs: number): { lowKm: number; highKm: number }`: min / max of `propagateEcef(satrec, startMs + k·60 000, scratch).altKm` for k = 0…ceil(period in minutes), into one local `createSatStateEcef()`; called once per selection, never per frame.
  - `tleEpochMs(satrec: SatRec): number` (Unix ms, UTC)
  - `interface IntlDesignator { launchYear: number; designator: string }`
  - `internationalDesignator(tle1: string): IntlDesignator | null`

- [ ] **Step 1: Write the failing test.** In `orbital.test.ts`, delete the local `JD_UNIX_EPOCH` (:37-38) and `tleEpochMs` helper (:48-51), and import `tleEpochMs` (plus the two new names) from `./orbital`. Existing call sites stay as they are. Then add:
```ts
describe('perigeeApogeeKm', () => {
  it('ISS fixture: 415.7 / 424.8 km above the equatorial radius', () => {
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(issSatrec())
    expect(perigeeKm).toBeCloseTo(415.72, 1)
    expect(apogeeKm).toBeCloseTo(424.8, 1)
  })
  it('GEO fixture spans about ±28 km around 35 787 km', () => {
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(createSatrec(ISS_TLE1, GEO_TLE2)!)
    expect(perigeeKm).toBeCloseTo(35_759.0, 0)
    expect(apogeeKm).toBeCloseTo(35_815.4, 0)
  })
})

describe('tleEpochMs', () => {
  it('is 2026-07-10T03:41:07.909Z, matching line 1 cols 19-32 read by hand', () => {
    const ms = tleEpochMs(issSatrec())
    expect(Math.abs(ms - Date.UTC(2026, 6, 10, 3, 41, 7, 909))).toBeLessThan(1)
    const field = ISS_TLE1.slice(18, 32) // '26191.15356376'
    const byHand = Date.UTC(2000 + Number(field.slice(0, 2)), 0, 1) + (Number(field.slice(2)) - 1) * 86_400_000
    expect(Math.abs(ms - byHand)).toBeLessThan(1)
  })
})

describe('internationalDesignator', () => {
  const withField = (f: string) => ISS_TLE1.slice(0, 9) + f + ISS_TLE1.slice(17)
  it('reads line 1 cols 10-17 with the 57 year pivot', () => {
    expect(internationalDesignator(ISS_TLE1)).toEqual({ launchYear: 1998, designator: '1998-067A' })
    expect(internationalDesignator(withField('24001AB '))).toEqual({ launchYear: 2024, designator: '2024-001AB' })
    expect(internationalDesignator(withField('57001B  '))).toEqual({ launchYear: 1957, designator: '1957-001B' })
    expect(internationalDesignator(withField('56123C  '))).toEqual({ launchYear: 2056, designator: '2056-123C' })
  })
  it('returns null for a blank, garbled or short field', () => {
    expect(internationalDesignator(withField('        '))).toBeNull()
    expect(internationalDesignator(withField('9806 A  '))).toBeNull()
    expect(internationalDesignator('1 25544U')).toBeNull()
  })
})
```
Create `orbital.crosscheck.test.ts`. This is the different-method check: it compares against an SGP4 run, not the same formula a second time. Copy `ISS_TLE1`, `ISS_TLE2` and `GEO_TLE2` from `orbital.test.ts`, and add `HEO_TLE2`:
```ts
/** ISS line 2 rewritten to a Molniya-like orbit: e = 0.7, 2.006 rev/day, i = 63.4°, ω = 270° (69 chars). */
const HEO_TLE2 = '2 25544  63.4000 186.4276 7000000 270.0000  82.1339  2.00600000575314'

describe('perigeeApogeeKm vs one SGP4 orbit (different method)', () => {
  // Oracle: min/max of |r_ECI| − 6378.135 km every 10 s over one period. NOT propagateEcef's
  // geodetic altKm: for the ISS that runs 419.8–433.0 km because of Earth's flattening.
  it.each([
    ['ISS', ISS_TLE2, 5], // measured −1.4 / +3.5 km
    ['GEO', GEO_TLE2, 10], // −5.4 / +6.1
    ['HEO', HEO_TLE2, 15], // −11.2 / +9.7
  ])('%s within %d km', (_name, tle2, tolKm) => {
    const satrec = createSatrec(ISS_TLE1, tle2)!
    const start = tleEpochMs(satrec)
    const periodMs = orbitalPeriodMinutes(satrec) * 60_000
    let min = Infinity
    let max = -Infinity
    for (let t = 0; t <= periodMs; t += 10_000) {
      const p = propagate(satrec, new Date(start + t))!.position
      const alt = Math.hypot(p.x, p.y, p.z) - constants.earthRadius
      min = Math.min(min, alt)
      max = Math.max(max, alt)
    }
    const { perigeeKm, apogeeKm } = perigeeApogeeKm(satrec)
    expect(Math.abs(perigeeKm - min)).toBeLessThan(tolKm)
    expect(Math.abs(apogeeKm - max)).toBeLessThan(tolKm)
  })
})
```
  Also import `altitudeSpanKm` and add (ISS fixture at its TLE epoch; values measured in planning by a 10 s SGP4 sweep):
```ts
describe('altitudeSpanKm', () => {
  it('spans the geodetic altitude NOW shows over one orbit', () => {
    const satrec = issSatrec()
    const start = tleEpochMs(satrec)
    const { lowKm, highKm } = altitudeSpanKm(satrec, start)
    expect(Math.abs(lowKm - 419.8)).toBeLessThan(1)
    expect(Math.abs(highKm - 433.0)).toBeLessThan(1)
    const s = createSatStateEcef()
    for (let ms = start; ms < start + orbitalPeriodMinutes(satrec) * 60_000; ms += 10_000) {
      const alt = propagateEcef(satrec, ms, s)!.altKm
      expect(alt).toBeGreaterThanOrEqual(lowKm - 0.5)
      expect(alt).toBeLessThanOrEqual(highKm + 0.5)
    }
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- orbital`. It fails with `perigeeApogeeKm is not a function` (and the same for the other two exports).
- [ ] **Step 3: Implement.**
  - Add `MS_PER_DAY = 86_400_000`, `JD_UNIX_EPOCH = 2_440_587.5` and `EARTH_EQUATORIAL_RADIUS_KM = constants.earthRadius`. Keep the existing `EARTH_RADIUS_M` mean radius for the footprint; do not reuse it.
  - `perigeeApogeeKm`: `a = satrec.a * R`, then `{ perigeeKm: a * (1 - e) - R, apogeeKm: a * (1 + e) - R }`.
  - `altitudeSpanKm`: the 60 s sweep from the Interfaces block; skip samples where `propagateEcef` returns null.
  - `tleEpochMs`: `(satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY`.
  - `internationalDesignator`: `tle1.slice(9, 17).trimEnd()` must match `/^(\d{2})(\d{3})([A-Z]{1,3})$/`, otherwise return null. Years 57–99 → 19xx, 00–56 → 20xx. Designator = `${year}-${launch}${piece}`.
  - Each JSDoc names its units, the radius convention and the column range. `lib/orbital.ts` itself must never import `cesium` (the worker bundles it); only the crosscheck test file does.
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- orbital`, then `npm run lint && npm test` from the root.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/orbital.ts apps/web/src/lib/orbital.test.ts apps/web/src/lib/orbital.crosscheck.test.ts`, then `git commit -m "feat(web): derive perigee, apogee, epoch and designator from tle"`.

### Task 5.2: Sun position, Earth shadow, observer sun elevation (`lib/orbital`)
**Files:**
- Modify: `apps/web/src/lib/orbital.ts:1-16` (module header), `:53-63,76-78` (`SatStateEcef`, `createSatStateEcef`), `:180-188` (`propagateEcef` writes), `:362-366` (factor out `toObserverGd`); new exports after `footprintRadiusM` (:312-315)
- Modify: `apps/web/src/lib/orbital.test.ts`, `apps/web/src/lib/orbital.crosscheck.test.ts`
- Test: same two files

**Interfaces:**
- Consumes: `Vec3Like`, `ObserverGeo`, `gstime(jd: number)`, `eciToEcf`, `ecfToLookAngles`, and `tleEpochMs` from 5.1.
- Produces:
  - `SatStateEcef.positionEciKm: Vec3Like`: ECI (TEME) km at the same instant, as SGP4 returned it. Used for frame-free tests; never drawn.
  - `sunPositionEciKm(epochMs: number, out: Vec3Like): Vec3Like`: fills `out` and returns it; allocates nothing.
  - `isSunlit(satEciKm: Readonly<Vec3Like>, sunEciKm: Readonly<Vec3Like>): boolean`: both vectors share one frame and one instant. Only the Sun's direction is used.
  - `sunElevationDeg(observer: ObserverGeo, epochMs: number): number`: degrees, geometric.
  - Private `toObserverGd(observer: ObserverGeo): GeodeticLocation` (radians, km), reused by `predictPasses`.

- [ ] **Step 1: Write the failing test** in `orbital.test.ts`:
```ts
// in describe('propagateEcef'), and add `const eciRef = out.positionEciKm` / `expect(out.positionEciKm).toBe(eciRef)` to the "fills `out` in place" test
it('carries the SGP4 ECI km position of the same instant, untouched', () => {
  const satrec = issSatrec()
  const ms = tleEpochMs(satrec) + 600_000
  expect(propagateEcef(satrec, ms)!.positionEciKm).toEqual(propagate(satrec, new Date(ms))!.position)
})

describe('sunPositionEciKm', () => {
  it('puts the Sun at RA 0/90/180/270° on the 2026 equinoxes and solstices', () => {
    const cases: [number, number, number][] = [
      [Date.UTC(2026, 2, 20, 14, 46), 0, 0],
      [Date.UTC(2026, 5, 21, 8, 24), 90, 23.436],
      [Date.UTC(2026, 8, 23, 0, 5), 180, 0],
      [Date.UTC(2026, 11, 21, 20, 50), 270, -23.436],
    ]
    const sun = { x: 0, y: 0, z: 0 }
    for (const [ms, raDeg, declDeg] of cases) {
      expect(sunPositionEciKm(ms, sun)).toBe(sun)
      const ra = (Math.atan2(sun.y, sun.x) * 180) / Math.PI
      expect(Math.abs(((ra - raDeg + 540) % 360) - 180)).toBeLessThan(0.05) // measured ≤ 0.007°
      expect((Math.asin(sun.z / Math.hypot(sun.x, sun.y, sun.z)) * 180) / Math.PI).toBeCloseTo(declDeg, 1)
    }
  })
  it('is 147.1 million km away at perihelion and 152.1 at aphelion (2026)', () => {
    const sun = { x: 0, y: 0, z: 0 }
    sunPositionEciKm(Date.UTC(2026, 0, 3), sun)
    expect(Math.hypot(sun.x, sun.y, sun.z) / 1e6).toBeCloseTo(147.1, 1)
    sunPositionEciKm(Date.UTC(2026, 6, 6), sun)
    expect(Math.hypot(sun.x, sun.y, sun.z) / 1e6).toBeCloseTo(152.1, 1)
  })
})

describe('isSunlit (cylindrical umbra, R = 6378.135 km)', () => {
  const sun = { x: 149.6e6, y: 0, z: 0 }
  it('is lit on the day side and outside the shadow cylinder, dark inside it', () => {
    expect(isSunlit({ x: 7000, y: 0, z: 0 }, sun)).toBe(true)
    expect(isSunlit({ x: 0, y: 7000, z: 0 }, sun)).toBe(true) // terminator plane
    expect(isSunlit({ x: -7000, y: 6400, z: 0 }, sun)).toBe(true)
    expect(isSunlit({ x: -7000, y: 6300, z: 0 }, sun)).toBe(false)
    expect(isSunlit({ x: -7000, y: 0, z: 0 }, sun)).toBe(false)
    expect(isSunlit({ x: -7000, y: 6300, z: 0 }, { x: 1, y: 0, z: 0 })).toBe(false) // direction only
  })
  it('ISS: sunlit at the fixture epoch, in shadow mid-eclipse 12 days later', () => {
    const satrec = issSatrec()
    const sun = { x: 0, y: 0, z: 0 }
    const lit = tleEpochMs(satrec) // high-beta season: the whole orbit is sunlit
    const dark = lit + 12 * 86_400_000 + 2_945_000 // 2026-07-22T04:30Z, middle of a 35 min eclipse
    expect(isSunlit(propagateEcef(satrec, lit)!.positionEciKm, sunPositionEciKm(lit, sun))).toBe(true)
    expect(isSunlit(propagateEcef(satrec, dark)!.positionEciKm, sunPositionEciKm(dark, sun))).toBe(false)
  })
})

describe('sunElevationDeg', () => {
  it('peaks at 90° − lat + 23.436° over Prague on the June solstice', () => {
    let max = -90
    for (let ms = Date.UTC(2026, 5, 21, 10); ms <= Date.UTC(2026, 5, 21, 12); ms += 60_000) {
      max = Math.max(max, sunElevationDeg(PRAGUE, ms))
    }
    expect(max).toBeCloseTo(90 - 50.08 + 23.436, 1) // measured 63.355
  })
  it('is −16.7° at 00:00 and 60.3° at 12:00 UTC over Prague on 2026-07-10', () => {
    expect(sunElevationDeg(PRAGUE, Date.UTC(2026, 6, 10, 0))).toBeCloseTo(-16.74, 1)
    expect(sunElevationDeg(PRAGUE, Date.UTC(2026, 6, 10, 12))).toBeCloseTo(60.28, 1)
  })
})
```
Append to `orbital.crosscheck.test.ts`, which now also imports `Cartesian3, Ellipsoid, EllipsoidalOccluder, JulianDate, Matrix3, Simon1994PlanetaryPositions, Transforms` from `cesium` (as `core/engine/CameraRig.test.ts` does) and `eciToEcf, gstime, jday, sunPos` from `satellite.js`:
```ts
/** The Sun Cesium lights the globe with (createViewer.ts:161): Simon 1994, ICRF → fixed via the
 *  TEME fallback (no EOP data is loaded), ECEF metres. */
function cesiumSunEcefM(ms: number): Cartesian3 {
  const jd = JulianDate.fromDate(new Date(ms))
  const inertial = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(jd)
  return Matrix3.multiplyByVector(Transforms.computeTemeToPseudoFixedMatrix(jd), inertial, new Cartesian3())
}
const angleDeg = (a: Vec3Like, b: Vec3Like) =>
  (Math.acos(Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)))) * 180) / Math.PI

describe('Sun and shadow vs Cesium (different method)', () => {
  const iss = createSatrec(ISS_TLE1, ISS_TLE2)!
  const E = tleEpochMs(iss)
  it("sun direction within 0.5° of Cesium's at six instants", () => {
    for (const ms of [E, Date.UTC(2026, 2, 20, 14, 46), Date.UTC(2026, 5, 21, 8, 24), Date.UTC(2026, 8, 23, 0, 5), Date.UTC(2026, 11, 21, 20, 50), Date.UTC(2026, 10, 18, 12)]) {
      const ecf = eciToEcf(sunPositionEciKm(ms, { x: 0, y: 0, z: 0 }), gstime(new Date(ms)))
      expect(angleDeg(ecf, cesiumSunEcefM(ms))).toBeLessThan(0.5) // measured 0.363–0.371° (precession Cesium omits)
    }
  })
  it('canary: satellite.js 6.0.2 sunPos is more than 1° off at the fixture epoch (why lib/orbital has its own)', () => {
    const r = sunPos(jday(new Date(E))).rsun
    expect(angleDeg(eciToEcf({ x: r[0], y: r[1], z: r[2] }, gstime(new Date(E))), cesiumSunEcefM(E))).toBeGreaterThan(1) // measured 1.40°
  })
  it("shadow flag matches Cesium's ellipsoidal occluder over one orbit", () => {
    const periodMs = orbitalPeriodMinutes(iss) * 60_000
    const sun = { x: 0, y: 0, z: 0 }
    const count = (start: number) => {
      let ours = 0, disagree = 0, sunPosShadow = 0
      for (let t = 0; t < periodMs; t += 10_000) {
        const ms = start + t
        const s = propagateEcef(iss, ms)!
        const mine = isSunlit(s.positionEciKm, sunPositionEciKm(ms, sun))
        const cesium = new EllipsoidalOccluder(Ellipsoid.WGS84, cesiumSunEcefM(ms)).isPointVisible(Cartesian3.fromArray(s.positionEcefM))
        const r = sunPos(jday(new Date(ms))).rsun
        if (!isSunlit(s.positionEciKm, { x: r[0], y: r[1], z: r[2] })) sunPosShadow++
        if (!mine) ours++
        if (mine !== cesium) disagree++
      }
      return { ours, disagree, sunPosShadow }
    }
    const epoch = count(E) // measured: ours 0, Cesium 0, sunPos 22 (the known-bad input this oracle catches)
    expect(epoch.ours).toBe(0)
    expect(epoch.disagree).toBe(0)
    expect(epoch.sunPosShadow).toBeGreaterThanOrEqual(20)
    const later = count(E + 12 * 86_400_000) // measured: 214 shadow samples, 2 disagree (sphere vs WGS84 at the edge)
    expect(later.ours).toBeGreaterThanOrEqual(150)
    expect(later.disagree).toBeLessThanOrEqual(3)
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- orbital`. It fails with `sunPositionEciKm is not a function`, and `positionEciKm` is `undefined`.
- [ ] **Step 3: Implement.**
  - `createSatStateEcef` adds `positionEciKm: { x: 0, y: 0, z: 0 }`. `propagateEcef` copies `pv.position.x/y/z` into it next to the ECEF write: three number writes, no allocation.
  - Rewrite the module header: the ECI-km exports are now `sampleOrbitRingEci`, `SatStateEcef.positionEciKm` and `sunPositionEciKm`, which feed frame-free math (ring rotation, Earth shadow) and are never drawn.
  - `sunElevationDeg = ecfToLookAngles(toObserverGd(observer), eciToEcf(sun, gstime(jd))).elevation × RAD_TO_DEG`, with `jd = epochMs / MS_PER_DAY + JD_UNIX_EPOCH`.
  - Use the following exact code; the fix is the whole point:
```ts
const AU_KM = 149_597_870.7
export function sunPositionEciKm(epochMs: number, out: Vec3Like): Vec3Like {
  // Vallado low-precision Sun, the series satellite.js 6.0.2 `sunPos` uses, with the mean anomaly
  // converted as a whole (sunPos applies deg2rad to the rate term only: ~1° error). Mean equator and
  // equinox of date, which matches TEME to < 0.01°; UTC is used for TT (69 s, < 0.001°).
  const t = (epochMs / MS_PER_DAY + JD_UNIX_EPOCH - 2_451_545) / 36_525
  const meanLongDeg = (280.46 + 36_000.77 * t) % 360
  const m = ((357.5277233 + 35_999.05034 * t) * DEG_TO_RAD) % (2 * Math.PI)
  const eclLon = (meanLongDeg + 1.914666471 * Math.sin(m) + 0.019994643 * Math.sin(2 * m)) * DEG_TO_RAD
  const obliquity = (23.439291 - 0.0130042 * t) * DEG_TO_RAD
  const rKm = (1.000140612 - 0.016708617 * Math.cos(m) - 0.000139589 * Math.cos(2 * m)) * AU_KM
  out.x = rKm * Math.cos(eclLon)
  out.y = rKm * Math.cos(obliquity) * Math.sin(eclLon)
  out.z = rKm * Math.sin(obliquity) * Math.sin(eclLon)
  return out
}

export function isSunlit(sat: Readonly<Vec3Like>, sun: Readonly<Vec3Like>): boolean {
  const along = (sat.x * sun.x + sat.y * sun.y + sat.z * sun.z) / Math.hypot(sun.x, sun.y, sun.z)
  if (along >= 0) return true // day side of the terminator plane
  const R = EARTH_EQUATORIAL_RADIUS_KM
  return sat.x * sat.x + sat.y * sat.y + sat.z * sat.z - along * along > R * R // outside the shadow cylinder
}
```
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- orbital` and `npx tsc -b apps/web`, then `npm run lint && npm test`.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/orbital.ts apps/web/src/lib/orbital.test.ts apps/web/src/lib/orbital.crosscheck.test.ts`, then `git commit -m "feat(web): add sun position and earth-shadow test to lib/orbital"`.

### Task 5.3: Pass rise/set azimuth and naked-eye flag (`predictPasses`)
**Files:**
- Modify: `apps/web/src/lib/protocol.ts:30-38` (`PassPrediction`)
- Modify: `apps/web/src/lib/orbital.ts:317-344` (`lookAnglesAt`), `:388-419` (`finalizePass`), `:346-354` (JSDoc)
- Modify: `apps/web/src/features/passes/passesStore.test.ts:7-14` (fixture factory gains the new fields)
- Test: `apps/web/src/lib/orbital.test.ts` (describe `predictPasses`, :232-270)

**Interfaces:**
- Consumes: `sunPositionEciKm`, `isSunlit`, `toObserverGd` and the private sun-elevation path from 5.2.
- Produces:
  - `PassPrediction.riseAzDeg: number` and `PassPrediction.setAzDeg: number`: azimuth in degrees, 0 = N, clockwise, of the first and last sample with `elDeg >= 0`. NaN when the pass has none. For a pass already in progress at the window start, "rise" is where it is at the window start.
  - `PassPrediction.nakedEye: boolean`: true when, at one or more samples with `elDeg >= 0`, the satellite is sunlit while the observer's Sun is below −6°.
  - `export const NAKED_EYE_SUN_MAX_ELEVATION_DEG = -6`

- [ ] **Step 1: Write the failing test** (add to describe `predictPasses`; import `sunElevationDeg` and `NAKED_EYE_SUN_MAX_ELEVATION_DEG`):
```ts
it('adds rise/set azimuth and the naked-eye flag (ISS over Prague, 24 h from epoch)', () => {
  const satrec = issSatrec()
  const passes = predictPasses(satrec, PRAGUE, tleEpochMs(satrec), 24)
  // AOS 17:47 (sun +10°), 19:22 (sun −2.3…−3.6°: civil twilight), 20:58, 22:35, 00:12, 01:49 UTC
  expect(passes.map((p) => p.nakedEye)).toEqual([false, false, true, true, true, true])
  const azimuths = [[179.2, 85.1], [226.6, 72.8], [260.3, 77.6], [281.1, 96.9], [287.4, 129.4], [277.4, 174.8]]
  passes.forEach((p, i) => {
    expect(Math.abs(p.riseAzDeg - azimuths[i][0])).toBeLessThan(0.5)
    expect(Math.abs(p.setAzDeg - azimuths[i][1])).toBeLessThan(0.5)
    const above = p.samples.filter((s) => s.elDeg >= 0)
    expect(p.riseAzDeg).toBe(above[0].azDeg)
    expect(p.setAzDeg).toBe(above[above.length - 1].azDeg)
  })
  // The second pass is false only because of the −6° threshold: sunlit, sky not dark yet.
  const twilight = sunElevationDeg(PRAGUE, passes[1].maxElMs)
  expect(twilight).toBeLessThan(0)
  expect(twilight).toBeGreaterThan(NAKED_EYE_SUN_MAX_ELEVATION_DEG)
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- orbital`. It fails because `nakedEye` is undefined (`expected [undefined, …] to equal [false, …]`).
- [ ] **Step 3: Implement.**
  - The private `LookSample` gains `eciKm: EciVec3<number>`, the `pv.position` reference with no copy.
  - In `finalizePass`, add `let nakedEye = false`. In `pushSample`, while `!nakedEye` and `look.elDeg >= 0`: compute the Sun once into a module-scope `scratchSunEciKm`, check the observer's sun elevation first (reuse the `observerGd` already built via `toObserverGd`), then `isSunlit(look.eciKm, scratchSunEciKm)`.
  - After sampling, set rise/set with one forward and one backward loop over `samples` (no `findLast`), then push `{ …, riseAzDeg, setAzDeg, nakedEye }`.
  - Add the three fields to the `pass()` factory in `passesStore.test.ts` (`riseAzDeg: 270, setAzDeg: 90, nakedEye: false`).
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- orbital` and `-- passesStore`, plus `npx tsc -b apps/web`, then `npm run lint && npm test`.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/protocol.ts apps/web/src/lib/orbital.ts apps/web/src/lib/orbital.test.ts apps/web/src/features/passes/passesStore.test.ts`, then `git commit -m "feat(web): predict pass rise/set azimuth and naked-eye visibility"`.

### Task 5.4: Countdown, compass, data-age and HH:MM formatters (`lib/format`)
**Files:**
- Modify: `apps/web/src/lib/format.ts` (append after `formatRate`, :56-59; existing helpers unchanged)
- Test: `apps/web/src/lib/format.test.ts` (imports :2-9; add `it`s inside the describe, which ends at :42)

**Interfaces:**
- Consumes: the module-private `pad`.
- Produces:
  - `formatCountdown(ms: number): string`: a span of sim time as rounded-up whole minutes (≥ 1). `'3 MIN'`, or `'2 H 07'` from an hour. Also used for pass duration.
  - `formatCompass8(azDeg: number): string`: `'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'`, or `'—'` when the input is not finite.
  - `formatDataAge(deltaMs: number): string`: `deltaMs = sim − TLE epoch`. Output is the magnitude plus `OLD` (≥ 0) or `AHEAD` (< 0).
  - `formatUtcHm(epochMs: number): string`: `'18:42'`, UTC, seconds truncated.

- [ ] **Step 1: Write the failing test:**
```ts
it('formatCountdown: rounded-up minutes, H MM from an hour', () => {
  expect(formatCountdown(7_620_000)).toBe('2 H 07')
  expect(formatCountdown(180_000)).toBe('3 MIN')
  expect(formatCountdown(20_000)).toBe('1 MIN')
  expect(formatCountdown(0)).toBe('1 MIN')
  expect(formatCountdown(3_540_001)).toBe('1 H 00')
  expect(formatCountdown(476_250)).toBe('8 MIN') // a pass duration
})
it('formatCompass8: 45° sectors centred on the points, boundaries go clockwise', () => {
  const cases: [number, string][] = [[0, 'N'], [22.4, 'N'], [22.5, 'NE'], [90, 'E'], [179.2, 'S'], [226.6, 'SW'],
    [260.3, 'W'], [292.5, 'NW'], [337.4, 'NW'], [337.5, 'N'], [359.9, 'N'], [360, 'N'], [-45, 'NW']]
  for (const [az, point] of cases) expect(formatCompass8(az)).toBe(point)
  expect(formatCompass8(Number.NaN)).toBe('—')
})
it('formatDataAge: magnitude with OLD / AHEAD', () => {
  expect(formatDataAge(25 * 60_000)).toBe('25 MIN OLD')
  expect(formatDataAge(-5 * 3_600_000)).toBe('5.0 H AHEAD')
  expect(formatDataAge(103_680_000)).toBe('1.2 D OLD')
  expect(formatDataAge(15 * 86_400_000)).toBe('15 D OLD')
  expect(formatDataAge(0)).toBe('0 MIN OLD')
})
it('formatUtcHm renders HH:MM UTC with seconds truncated', () => {
  expect(formatUtcHm(Date.UTC(2026, 6, 10, 18, 42, 59))).toBe('18:42')
  expect(formatUtcHm(Date.UTC(2026, 6, 10, 3, 5, 0))).toBe('03:05')
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- format`. It fails with `formatCountdown is not a function`.
- [ ] **Step 3: Implement.**
  - `formatCountdown`: `m = max(1, ceil(ms / 60 000))`; `m < 60` gives `${m} MIN`, otherwise `${floor(m / 60)} H ${pad(m % 60)}`.
  - `formatCompass8`: `POINTS[Math.round((((az % 360) + 360) % 360) / 45) % 8]`.
  - `formatDataAge` on `|Δ|`: under 1 h, `${round(min)} MIN`; under 24 h, hours `toFixed(1)` + ` H`; under 10 d, days `toFixed(1)` + ` D`; otherwise `${round(days)} D`. Then append ` OLD` or ` AHEAD`.
  - `formatUtcHm` uses `getUTCHours` / `getUTCMinutes`.
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- format`, then `npm run lint && npm test`.
- [ ] **Step 5: Commit.** `git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts`, then `git commit -m "feat(web): add countdown, compass, data-age and hh:mm formatters"`.

### Task 5.5: Push orbit facts and SUNLIT to telemetry (tracking)
**Files:**
- Modify: `apps/web/src/features/tracking/telemetryStore.ts:4-33`
- Modify: `apps/web/src/features/tracking/SelectedSatellite.ts:1-12` (imports), `:59-67` (scratch field), `:96-101` (identity push in `select`), `:123-131` (5 Hz push in `frame`)
- Modify: `apps/web/src/features/tracking/CLAUDE.md` (Depends on, Invariants)
- Test: `apps/web/src/features/tracking/SelectedSatellite.test.ts`

**Interfaces:**
- Consumes: `perigeeApogeeKm`, `tleEpochMs`, `internationalDesignator` (5.1); `sunPositionEciKm`, `isSunlit`, `SatStateEcef.positionEciKm`, `Vec3Like` (5.2).
- Produces: `TelemetryState` gains `sunlit: boolean | null`, `perigeeKm: number`, `apogeeKm: number`, `tleEpochMs: number | null`, `launchYear: number | null` and `designator: string | null`. `EMPTY` sets them to `null, 0, 0, null, null, null`, so `clear()` resets them on every select or deselect. It also gains `lowKm: number` and `highKm: number` (from `altitudeSpanKm`, `0, 0` in `EMPTY`).

- [ ] **Step 1: Write the failing test** (append to describe `SelectedSatellite`):
```ts
const SHADOW_MS = EPOCH_MS + 12 * 86_400_000 + 2_945_000 // mid-eclipse 2026-07-22T04:30Z (lib/orbital.test.ts)

it('select() pushes the orbit facts once, and no sunlit flag yet', () => {
  new SelectedSatellite(fakeVisuals()).select(ISS, EPOCH_MS)
  const t = useTelemetry.getState()
  expect(t.perigeeKm).toBeCloseTo(415.72, 1)
  expect(t.apogeeKm).toBeCloseTo(424.8, 1)
  expect(Math.abs(t.lowKm - 419.8)).toBeLessThan(1)
  expect(Math.abs(t.highKm - 433.0)).toBeLessThan(1)
  expect(Math.abs(t.tleEpochMs! - Date.UTC(2026, 6, 10, 3, 41, 7, 909))).toBeLessThan(1)
  expect(t.launchYear).toBe(1998)
  expect(t.designator).toBe('1998-067A')
  expect(t.sunlit).toBeNull()
})

it('a blank designator field pushes null launch facts', () => {
  const tle1 = ISS.tle1.slice(0, 9) + ' '.repeat(8) + ISS.tle1.slice(17)
  new SelectedSatellite(fakeVisuals()).select({ ...ISS, tle1 }, EPOCH_MS)
  expect(useTelemetry.getState().launchYear).toBeNull()
  expect(useTelemetry.getState().designator).toBeNull()
})

it('pushes sunlit with the 5 Hz readout, for the propagated instant', () => {
  const sel = new SelectedSatellite(fakeVisuals())
  sel.select(ISS, EPOCH_MS)
  sel.frame(EPOCH_MS, 1000)
  expect(useTelemetry.getState().sunlit).toBe(true)
  sel.frame(SHADOW_MS, 1100) // inside the 200 ms pacing window: held
  expect(useTelemetry.getState().sunlit).toBe(true)
  sel.frame(SHADOW_MS, 1300)
  expect(useTelemetry.getState().sunlit).toBe(false)
  sel.select(null, EPOCH_MS)
  expect(useTelemetry.getState().sunlit).toBeNull()
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- SelectedSatellite`. It fails with `expected undefined to be close to 415.72`.
- [ ] **Step 3: Implement.**
  - `private readonly _sunEciKm: Vec3Like = { x: 0, y: 0, z: 0 }` is the only scratch.
  - `select()` adds the orbit facts (the five above plus `lowKm` / `highKm` from `altitudeSpanKm(satrec, epochMs)`) to its existing identity `update`.
  - Inside the existing `nowMs - _lastTelemetryMs > TELEMETRY_INTERVAL_MS` block, `frame()` adds `sunlit: isSunlit(live.positionEciKm, sunPositionEciKm(epochMs, this._sunEciKm))`. It uses the same `epochMs` as `propagateEcef`, is never evaluated outside that block, and allocates nothing on our side.
  - CLAUDE.md:
    - Depends on: add the five `lib/orbital` names.
    - Invariants: add one bullet: "SUNLIT is computed only inside the ~5 Hz telemetry push, for the same instant as the live propagation, into the one `_sunEciKm` scratch, never per frame; orbit facts (perigee/apogee, TLE epoch, designator) are pushed once in `select()`."
    - Keep the file under 25 lines.
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- SelectedSatellite` and `npx tsc -b apps/web`, then `npm run lint && npm test`.
- [ ] **Step 5: Commit.** `git add apps/web/src/features/tracking/telemetryStore.ts apps/web/src/features/tracking/SelectedSatellite.ts apps/web/src/features/tracking/SelectedSatellite.test.ts apps/web/src/features/tracking/CLAUDE.md`, then `git commit -m "feat(tracking): push orbit facts and sunlit flag to telemetry"`.

### Task 5.6: TelemetryPanel as NOW / ORBIT (tracking, `@hud-designer` for CSS)
**Files:**
- Modify: `apps/web/src/features/tracking/satSummary.ts` (after `tleInclinationDeg`, :10-19)
- Modify: `apps/web/src/features/tracking/TelemetryPanel.tsx:1-65` (body rewritten; FOLLOW / ✕ unchanged)
- Create: `apps/web/src/styles/sat-detail.css`
- Modify: `apps/web/src/styles/index.css` (add `@import './sat-detail.css';` directly after `@import './telemetry.css';`)
- Modify: `apps/web/src/features/tracking/CLAUDE.md` (Owns, Depends on)
- Test: `apps/web/src/features/tracking/satSummary.test.ts`

**Interfaces:**
- Consumes: the `TelemetryState` fields from 5.5; `formatDataAge` and `formatUtc` (format); `formatKm`, `formatLatLon`, `formatDeg`, `formatCount` (existing); `useSimClock` (`core/sim/simClock`); `tleInclinationDeg` (existing).
- Produces:
  - `formatOrbitPeriod(periodMinutes: number): string`: under 120 min the period is shown in minutes, otherwise in hours, each with one decimal, followed by revolutions per day (`1440 / period`, one decimal).
  - `formatOrbitSpan(lowKm: number, highKm: number): string`: whole km with `formatCount`'s U+2009 thousands separator. One value when the two round equal.

- [ ] **Step 1: Write the failing test** (append to `satSummary.test.ts`):
```ts
describe('formatOrbitPeriod', () => {
  it('minutes below 2 h, hours above, with revolutions per day', () => {
    expect(formatOrbitPeriod(92.9756)).toBe('EVERY 93.0 MIN · 15.5× A DAY')
    expect(formatOrbitPeriod(1436.13)).toBe('EVERY 23.9 H · 1.0× A DAY')
    expect(formatOrbitPeriod(717.81)).toBe('EVERY 12.0 H · 2.0× A DAY')
  })
})
describe('formatOrbitSpan', () => {
  it('rounds to whole km, thin-space thousands, one value when equal', () => {
    expect(formatOrbitSpan(415.72, 424.8)).toBe('416–425 KM')
    expect(formatOrbitSpan(35_759.01, 35_815.37)).toBe('35 759–35 815 KM')
    expect(formatOrbitSpan(500.2, 500.4)).toBe('500 KM')
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- satSummary`. It fails with `formatOrbitPeriod is not a function`.
- [ ] **Step 3: Implement the helpers, then the panel.** Panel, top to bottom (strings fixed; layout is `@hud-designer`'s):
  - **Header** (`.telemetry-header`): `<h2 className="telemetry-name">` with the name (ellipsis, `title` = full name), then the `.orbit-class` badge (hue as today), then `.panel-actions` (FOLLOW, ✕) unchanged. The `TRACKING` title goes.
  - **NOW** (small block heading):
    - `{formatKm(altKm, 0)} · {v.toFixed(2)} KM/S · ` + flag span: `'☀︎ SUNLIT'` (`.sat-sunlit`) or `'● IN SHADOW'` (`.sat-shadow`). The flag is omitted while `sunlit === null`. U+FE0E keeps Android from drawing an emoji.
    - `OVER {formatLatLon(lat, lon)}`.
  - **ORBIT**:
    - `formatOrbitPeriod(periodMinutes)`.
    - `formatOrbitSpan(lowKm, highKm)` (owner call 15: the geodetic altitude NOW shows, so NOW always lies inside it), with title "Lowest–highest altitude over one orbit. Perigee–apogee {perigee}–{apogee} km above the 6378 km equatorial radius." Then ` · TILTED {formatDeg(incl, 1)}`, with title "Inclination: the orbit's angle to the equator". This part is omitted when `tleInclinationDeg` returns null.
    - `LAUNCHED {launchYear}` (omitted when null) ` · DATA {formatDataAge(simMin * 60_000 − tleEpochMs)}`, with title `TLE epoch ${formatUtc(tleEpochMs)} UTC — position accuracy falls the further sim time is from it`. `simMin = useSimClock((s) => Math.floor(s.epochMs / 60_000))` is the same per-sim-minute selector as PassesPanel. Data age is measured against sim time, never wall time.
  - **Identity line** (`.sat-identity`, small and dim): `NORAD {id}` + ` · {designator}` (title "International designator: launch year, launch number, piece") + ` · {GROUPS joined ' · ', upper}`.
  - `sat-detail.css` holds `.sat-title`, `.sat-block-title`, `.sat-line`, `.sat-sunlit`, `.sat-shadow` and `.sat-identity`. Colours come only from `tokens.css` custom properties; amber stays the selection signal (the name keeps `.telemetry-name`).
  - CLAUDE.md: Owns "the NOW / ORBIT readout panel"; Depends on adds `core/sim/simClock` (data age vs sim time).
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- satSummary`, then `npm run lint && npm test`. **Run the app** (`npm run dev`, http://localhost:5173), search "ISS" and select it:
  - **Header:** name, LEO badge, FOLLOW and ✕ sit on one row.
  - **NOW:** reads `4xx KM · 7.6x KM/S · ☀ SUNLIT` (or IN SHADOW) and `OVER …`.
  - **ORBIT:** reads `EVERY 9x.x MIN · 15.5× A DAY`, `4xx–4xx KM · TILTED 51.6°`, `LAUNCHED 1998 · DATA … OLD`, and the identity line `NORAD 25544 · 1998-067A · …`.
  - **Shadow flip:** at warp ×60 the flag flips to IN SHADOW about 20° of arc (~5 sim-min) after the marker crosses the globe's night terminator, not on it. That is correct: at 420 km the satellite sees the Sun until acos(6378/6798) ≈ 20° past the ground terminator.
  - **Scrub back:** scrubbing −12 h below the TLE epoch turns the data age into `… AHEAD`.
  - **GEO:** select a GEO satellite; it reads `EVERY 23.9 H · 1.0× A DAY` and a `35 7xx–35 8xx KM` span.
  - **Phone emulation** (360 × 740): open the details sheet. There is no horizontal overflow, a long name (a STARLINK) ellipsizes, and the console is clean.
- [ ] **Step 5: Commit.** `git add apps/web/src/features/tracking/satSummary.ts apps/web/src/features/tracking/satSummary.test.ts apps/web/src/features/tracking/TelemetryPanel.tsx apps/web/src/styles/sat-detail.css apps/web/src/styles/index.css apps/web/src/features/tracking/CLAUDE.md`, then `git commit -m "feat(tracking): regroup satellite detail into now and orbit"`.

### Task 5.7: PassesPanel as NEXT PASS OVER YOU (passes, `@hud-designer` for CSS)
**Files:**
- Create: `apps/web/src/features/passes/passView.ts`
- Modify: `apps/web/src/features/passes/PassesPanel.tsx:1-118` (panel), `:120-193` (`ObserverEditor` keeps its internals and is wrapped by a new `ObserverLine`)
- Modify: `apps/web/src/styles/passes.css:5-29,89-134`
- Modify: `docs/CONTROLS.md:127-141`, `apps/web/src/features/passes/CLAUDE.md`
- Test: `apps/web/src/features/passes/passView.test.ts`

**Interfaces:**
- Consumes: `PassPrediction.riseAzDeg/setAzDeg/nakedEye` (5.3); `formatCountdown`, `formatCompass8`, `formatUtcHm` (5.4); `formatLatLon`; the `usePasses` and `simClock` APIs unchanged.
- Produces:
  - `interface PassView { nextIndex: number; shownIndex: number; countdown: string | null }`
  - `passView(passes: readonly PassPrediction[], selectedPass: number | null, epochMs: number): PassView`. Rules:
    - `nextIndex` = the first pass with `losMs >= epochMs`, or −1.
    - `shownIndex` = `selectedPass` while that pass exists and has not ended, otherwise `nextIndex`.
    - `countdown` = `IN …` before AOS, `NOW · ENDS IN …` from AOS through LOS, and null when there is no next pass.

- [ ] **Step 1: Write the failing test:**
```ts
const p = (aosMs: number, losMs: number): PassPrediction => ({ noradId: 1, aosMs, losMs, maxElDeg: 40,
  maxElMs: (aosMs + losMs) / 2, samples: [], riseAzDeg: 270, setAzDeg: 90, nakedEye: false })
const PASSES = [p(1_000_000, 1_600_000), p(10_000_000, 10_500_000), p(20_000_000, 20_400_000)]

describe('passView', () => {
  it('counts down to the next pass in rounded-up minutes', () => {
    expect(passView(PASSES, null, 0)).toEqual({ nextIndex: 0, shownIndex: 0, countdown: 'IN 17 MIN' })
    expect(passView(PASSES, null, 2_000_000)).toEqual({ nextIndex: 1, shownIndex: 1, countdown: 'IN 2 H 14' })
  })
  it('reads NOW · ENDS IN during a pass, up to and including LOS', () => {
    expect(passView(PASSES, null, 1_200_000).countdown).toBe('NOW · ENDS IN 7 MIN')
    expect(passView(PASSES, null, 1_600_000)).toEqual({ nextIndex: 0, shownIndex: 0, countdown: 'NOW · ENDS IN 1 MIN' })
  })
  it('shows a picked pass until it ends, then falls back to the next', () => {
    expect(passView(PASSES, 2, 2_000_000).shownIndex).toBe(2)
    expect(passView(PASSES, 0, 2_000_000).shownIndex).toBe(1)
    expect(passView(PASSES, 7, 2_000_000).shownIndex).toBe(1)
  })
  it('has no next pass once the window is spent, or with no passes', () => {
    expect(passView(PASSES, null, 30_000_000)).toEqual({ nextIndex: -1, shownIndex: -1, countdown: null })
    expect(passView([], null, 0)).toEqual({ nextIndex: -1, shownIndex: -1, countdown: null })
  })
})
```
- [ ] **Step 2: Run it, expect FAIL.** Run `npm test -w apps/web -- passView`. It fails because `./passView` cannot be resolved.
- [ ] **Step 3: Implement `passView`, then the panel.** Prediction, `windowExpired` and `busy` logic stay exactly as they are. `passView` runs on the floored sim-minute `epochMs` the panel already has, and only when not `busy`: `const view = busy ? { nextIndex: -1, shownIndex: -1, countdown: null } : passView(passes, selectedPass, epochMs)`. The heading, next row, sky plot and later rows read only `view` (`startCompute` leaves the old `passes` in place, `passesStore.ts:42`, and the panel never paints old passes under a new name, `PassesPanel.tsx:69-71`). Panel, top to bottom:
  1. **Heading:** `<h2 className="hud-title">NEXT PASS OVER YOU{countdown && ` · ${countdown}`}</h2>`.
  2. **Status lines:** COMPUTING…, NO PASSES ABOVE 5° FOR THIS OBSERVER, and WINDOW ELAPSED — RECOMPUTING… (when `nextIndex < 0`) are unchanged.
  3. **Next pass:** one row in `<ul className="pass-list pass-next">`.
  4. **Sky plot:** `<SkyPlot pass={passes[shownIndex]} … />`, unchanged.
  5. **Later passes:** a `LATER` label, then `<ul className="pass-list">` with the rows for `i > nextIndex`. Ended passes are no longer listed.
  6. **`<ObserverLine />`:** always rendered, including while busy or with no passes.

  A local, non-exported `PassRow` renders each row:
  - **Selection:** the row button calls `selectPass(i)` and gets `is-active` when `i === shownIndex`.
  - **Cells:** `formatUtcHm(aosMs)` (plus ` UTC` on the next row), `${formatCompass8(riseAzDeg)} → ${formatCompass8(setAzDeg)}`, `${Math.round(maxElDeg)}°`, `formatCountdown(losMs − aosMs)`, and, when `nakedEye`, `◉ EYE` on the next row or `◉` on later rows (`.pass-eye`, title "Naked-eye pass: sunlit while the Sun is more than 6° below your horizon").
  - **WATCH ▶ button:** `hud-button pass-goto`, title "Jump sim time to this pass's start and play at ×10", aria-label `Watch the ${hm} UTC pass`. It keeps today's onClick: `scrubTo(aos)`, `setRate(10)`, `play()`, `selectPass(i)`.

  `ObserverLine` has local `editing` state:
  - Folded: `FROM {formatLatLon(lat, lon)}` plus a `CHANGE` button (`aria-expanded`).
  - Open: today's `ObserverEditor` plus `DONE`. It remounts on every open, so its fields re-read the store.

  The PassesPanel header comment is updated. `passes.css` adds `.pass-next` (it may wrap to two lines), `.pass-eye` (token colour, not amber), `.pass-later-label` and `.observer-line`, and moves the observer margins to the top. Constraints: no horizontal overflow in the 272 px stack (248 px content) or a 360 px sheet; rows stay ≥ `--tap-min` and WATCH / CHANGE ≥ 44 px on coarse pointers.

  `docs/CONTROLS.md:127-141` becomes:
  - **Next pass:** the heading counts down in sim time (`IN 2 H 07`; `NOW · ENDS IN 3 MIN` during a pass). The row shows AOS (UTC), rise → set direction (8-point), max elevation, duration, and ◉ EYE when the satellite is sunlit while your Sun is below −6°.
  - **Later passes:** compact rows; tap one to draw it on the sky plot.
  - **WATCH ▶:** jumps to AOS at ×10 and plays.
  - **Observer:** `FROM … · CHANGE` opens the lat/lon fields and GPS (Enter or blur commits) and DONE folds them. Prague default, persisted.
  - **Recompute:** the recompute bullet is unchanged.

  `HelpOverlay.tsx` needs no edit (it lists no pass controls). `passes/CLAUDE.md`:
  - Owns: "next-pass panel: countdown, direction, naked-eye flag, WATCH, folded observer line".
  - Depends on: add `lib/format`.
  - Invariants: add "`passView` alone decides the next pass, the shown pass and the countdown; a picked pass that ended falls back to the next; pass times are UTC, labelled".
  - How to test: add `-- passView`.
- [ ] **Step 4: Run it, expect PASS.** Run `npm test -w apps/web -- passView`, then `npm run lint && npm test`. **Run the app**, select the ISS, observer Prague:
  - **Heading and next row:** the heading reads `NEXT PASS OVER YOU · IN …`, and the next row reads `HH:MM UTC  X → Y  NN°  N MIN [◉ EYE]  WATCH ▶`.
  - **WATCH ▶:** sim time jumps to AOS at ×10. Within a sim minute the heading reads `NOW · ENDS IN …` and the sky-plot marker moves.
  - **EYE cross-check:** while a pass flagged EYE plays, the NOW block reads ☀ SUNLIT and the globe shows Prague on the night side. A daytime pass carries no EYE.
  - **Later rows:** tapping a later row switches the sky plot and highlights that row. After it ends, the plot falls back to the next pass.
  - **Observer line:** CHANGE shows lat/lon and GPS. Lat 10 + Enter recomputes. DONE folds the line back to `FROM 10.00°N 14.44°E · CHANGE`.
  - **GPS errors:** with DevTools Sensors set to location unavailable, and again with the permission blocked, the error shows under the fields.
  - **Phone emulation:** repeat the checks in the details sheet. Watch for overflow and console errors.
- [ ] **Step 5: Commit.** `git add apps/web/src/features/passes/passView.ts apps/web/src/features/passes/passView.test.ts apps/web/src/features/passes/PassesPanel.tsx apps/web/src/styles/passes.css docs/CONTROLS.md apps/web/src/features/passes/CLAUDE.md`, then `git commit -m "feat(passes): show next pass with countdown, direction and watch"`.

---

## Part 6: Whole-branch check and PR

### Task 6.1: Run the whole round, then open the PR

**Files:** none changed (screenshots go to the session scratchpad, not the repo).

- [ ] **Step 1: Gate.** From the repo root: `npm run lint && npm test && npm run build`. Expected: all green, no type errors.
- [ ] **Step 2: Run check across parts** (`npm run dev`, a private window, then Chrome DevTools device toolbar Pixel 7 412×915 and 360×740):
  - Boot screen: no time bar. Pick the ISS: the bar shows. Deselect while at ×60: the bar stays until NOW.
  - MARITIME + AIRSPACE + ORBITAL on: the rail and the LEGEND sheet stack all three in tab order; fold one and reload, and it stays folded.
  - COLORS: open a picker on desktop and at 360×740, type `7dd87d` + Enter, and the row turns green.
  - Nav: HOME, compass, zoom ± and LOCATE (emulated location allowed and denied), free and follow-locked, with no snap-back.
  - Satellite detail: NOW / ORBIT / NEXT PASS read as in the spec mockup; the NOW altitude lies inside the ORBIT span. Switch satellites: no countdown while COMPUTING. WATCH ▶ jumps to AOS at 10×.
  - The console shows no errors. Take one screenshot per item for the PR.
- [ ] **Step 3: Tree check.** `git status` shows only `.claude/.headroom_wrap_settings.lock` untracked and nothing modified.
- [ ] **Step 4: Push and open the PR** (load `conventions`): `git push -u origin feat/hud-nav-legend-palette`, then `gh pr create --base main`. The body has:
  - one section per part;
  - the screenshots;
  - **Calls made**: spec calls 1–16 (10 as revised);
  - **Risk paths touched**: `apps/web/src/core/engine/CameraRig.ts`, `createViewer.ts` (and `core/engine/CLAUDE.md` if Task 2.8 added a trap);
  - **Not verifiable here**: "Hex entry with the Android soft keyboard cannot be emulated; the owner checks it on the phone after the deploy."
  - no AI attribution line.
  The owner merges; a merge deploys.
