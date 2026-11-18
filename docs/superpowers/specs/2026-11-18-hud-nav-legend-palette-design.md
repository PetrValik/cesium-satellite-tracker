# HUD round: globe navigation, multi-domain legend, meaningful colours, satellite-only time bar

**Date:** 2026-11-18 · **Status:** draft, awaiting owner approval · **Branch:** `feat/hud-nav-legend-palette`

## Why

The owner uses orbit.irminsul.uk on a phone (Android Chrome). Screenshots from 2026-11-09/10 show four
friction points:

1. **Colours.** The hex field at the bottom of the colour picker cannot be edited on the phone, and the
   colours do not follow any meaning.
2. **Navigation.** Getting around the globe on a phone is awkward. There is no default view to tap back to.
3. **Several domains on.** With MARITIME + AIRSPACE both on, the legend (counts, colours, filters) is
   reachable only for the last domain turned on.
4. **Time bar.** It should show only when it is useful: when a satellite is picked.

Success: on a phone, the owner can type a hex colour, read a legend whose colours mean the same thing in
every domain, get back to the whole Earth (or level a tilted view) in one tap, reach the legend of every
domain that is on, and see the time bar only while it does something.

## Causes found in the code

| # | Symptom | Cause |
|---|---|---|
| 1a | Hex field not editable on the phone | `apps/web/src/app/SwatchPopover.tsx:100-106` closes the popover on any window `resize` or `scroll`. Focusing the field opens the soft keyboard, which resizes/pans the viewport, so the popover closes before a key lands. Read from the code, not reproduced on a device. |
| 1b | Colours carry no meaning | `apps/web/src/core/ui/prefsStore.ts:21-33`: military = green on aircraft, red on vessels; cargo = red on aircraft, cyan on vessels. Amber `#ffb454` is the selection signal (`core/engine/signalColors.ts:13`) **and** the LEO and tanker default. The swatch grid (`app/swatches.ts`) mixes hues inside a column (violet / blue / iris) and its rows are not a light→dark ramp. |
| 2 | No navigation aids | Every Cesium widget is off (`core/engine/createViewer.ts:77-89`). The only camera inputs are gestures and W A S D / Q E. The app reopens at the last saved camera (`app/globe/createGlobe.ts:51-58`), so the only way back to the whole Earth is pinching out. A two-finger tilt is easy to trigger by accident and nothing levels it again. |
| 3 | One domain's legend only | `app/railPicture.ts:25-27` returns the *focused* domain's picture (focus = the last tab turned on). Both the desktop left rail and the phone dock use it. |
| 4 | Time bar | `core/ui/modeStore.ts:95-97`: shown whenever the ORBITAL layer is on, with or without a selection. |

## Goals

- Hex entry works on a phone; the picker never closes because of the keyboard.
- One meaning → one colour across domains; amber is kept for the selection marker; the swatch grid is a
  clean hue × lightness grid.
- Users who never changed a colour get the new defaults; colours a user chose are kept.
- Four globe controls: compass (north-up + level), zoom + / −, home (whole Earth), locate me.
- The legend of every domain that is on is reachable in one tap on the phone and visible on desktop.
- The time bar shows only while a satellite is picked (or while sim time is away from NOW).

## Non-goals

- Selection details for several domains at once. Details keep following the focused domain, and picking an
  object already switches focus to its domain (`docs/CONTROLS.md`, "Clicking an object that belongs to
  another domain switches to that mode").
- Changing the reopen-at-last-camera behaviour.
- New basemaps, new layers, or a saved custom "home".

## Anti-goals (failure even if it "works")

- A compass that re-renders React every frame, or any per-frame allocation in the frame loop.
- Cesium objects created inside React components.
- A navigation control that fights the follow lock (camera snaps back after HOME, or a flight is cut by the
  lock re-engaging).
- A colour migration that overwrites a colour the user picked.
- Live feeds left suspended (sim time off NOW) with no visible way back to NOW.

## Constraints

- Cesium machinery stays in `apps/web/src/core/engine/` (non-React). That folder is a risk path in
  `.claude/kit.profile.yaml`; every create has a destroy; per-frame code allocates nothing.
- No cross-slice imports (`docs/ARCHITECTURE.md`). Slices meet in `app/`; shared state lives in `core/`.
- `npm run lint && npm test` green. Engine changes are verified by running the app, not by the suite.
- Touch targets ≥ 44 px, safe-area insets respected, HUD visual language (`@hud-designer`).
- Artefacts in English.

## Approaches

Picked by the owner on 2026-11-18 (all four were the recommended option).

| Part | Considered | Picked |
|---|---|---|
| Time bar | (a) only with a satellite picked · (b) only when ORBITAL is the focused domain · (c) keep the rule, collapse to a clock chip on the phone | **(a)**: it hides the bar on the default boot screen, where time warp does nothing useful, and still reaches every satellite use |
| Several domains | (a) one dock button, its sheet stacks every domain that is on · (b) one dock button per domain, HELP/COLORS/HIDE squeezed into a ⋯ menu · (c) one sheet with domain tabs inside | **(a)**: the dock stays at five buttons and one tap shows everything; (b) crowds the dock, (c) hides all but one again |
| Colours | (a) same meaning = same colour + rebuilt grid · (b) rebuild the grid only · (c) new defaults only | **(a)** |
| Navigation | home · zoom + / − · compass (north + level) · locate me | **all four** |

## Design

### 1. Colour picker and palette

**1a. Inline picker (fixes the hex field).** The picker renders *inline* inside the COLORS dialog, directly
under the row pair of the chip that opened it, spanning the full width of the colour grid. It replaces the
portalled, fixed-position popover on all layouts, which removes the placement maths and the
close-on-scroll/resize listeners that caused the bug.

- One picker open at a time (today's `openPicker` state in `SettingsPanel.tsx`).
- Closes on: a swatch pick (focus returns to the chip), Escape (stopped at the picker so it does not close
  the dialog — today's behaviour), tapping the chip again, or opening another row's picker. It does **not**
  close on scroll, resize or focus moving into the hex field.
- Hex field: `inputMode="text"`, `autoCapitalize="characters"`, `autoComplete="off"`,
  `enterKeyHint="done"`, `spellCheck={false}`. It commits on Enter and on blur (today's `commitHex`), and
  accepts `#RRGGBB` or bare `RRGGBB`.
- The browser scrolls the focused field into view inside the dialog's scroll container. No viewport-meta
  change is needed.

**1b. New defaults: one meaning, one hue.**

| Meaning | Hue | Aircraft | Vessels |
|---|---|---|---|
| Military | red `#f87171` | military | military |
| Civil / passenger (carries people) | blue `#4da6ff` | civil | passenger |
| Cargo / freight | green `#7dd87d` | cargo | cargo |
| Tanker | violet `#c084fc` | — | tanker |
| Fishing | teal `#2dd4bf` | — | fishing |
| High-speed craft | hot pink `#ff5f8f` | — | highspeed |
| Other / unknown | grey `#8a93a3` | (on-ground aircraft are already this grey, `SIGNAL_GROUND`) | other |

Satellites have no counterpart meaning in the other domains; they only have to stay off amber and be
distinct from each other: LEO ice `#a8f0ff`, MEO lime `#a3e635`, GEO gold `#ffd166`, HEO pink `#ffa1b5`.

Amber `#ffb454` is no longer a default for anything: it stays the selection / tracked-object signal.
White is dropped as a default because it vanishes on the default light `streets` basemap.

`@hud-designer` may adjust *shades* for legibility on both the light basemap and the dark night side /
`satellite` basemap. The meaning→hue mapping above is fixed.

**1c. Migration of stored colours.** Every visitor already has the full palette in localStorage:
`prefsStore` persists all colours on every write, including `saveCamera`, which the frame loop calls every
few seconds (`app/globe/frameLoop.ts:91-103`). Without a migration nobody would ever see the new defaults.

- Stored prefs gain a palette version (absent = v1).
- When v1 prefs are read, each colour equal to the **v1 default for that same key** becomes the v2 default.
  Any other value is a user choice and is kept. The result is persisted as v2.
- The v1 default table is kept in the code next to the migration (frozen; it is history, not config).
- RESET restores the v2 defaults, as today.

**1d. Swatch grid.** Columns are hue families in colour-wheel order (red → pink → violet → blue → cyan →
teal → green → lime → gold/amber → grey). Rows run light → base → deep → dim, the same ramp in every
column. Every v2 default appears in the grid (`swatches.test.ts` keeps holding that), and every swatch keeps
a name for its `aria-label` / `title`. The grid must fit a 360 px-wide phone inside the dialog (content box
320 px, `styles/dialogs.css:93-98`) with ≥ 32 px swatches and room for the selected ring
(`styles/colors.css:94-99`). Ten families do not fit that, so the **column count is the soft rule**: merge
neighbouring families into at most 8 columns (e.g. ice → cyan → teal as one column's ramp, lime → green as
another). Swatch size ≥ 32 px and one light→dark ramp per column are hard. Exact columns, shades and names
are `@hud-designer`'s call within those rules.

### 2. Globe navigation

**Controls**, as one vertical HUD stack:

| Control | Tap does | While follow-locked |
|---|---|---|
| Compass | The needle shows the camera heading. Tap turns the view north-up and looking straight down, keeping the point under the screen centre where it is. | Levels the follow camera north-up / straight down around the target; the lock stays. |
| Zoom + / − | Smooth zoom step (~0.3 s), each tap roughly halving / doubling the distance (the same distance-scaled step as the Q / E keys). | Zooms the follow range (as Q / E do today). |
| Home | Flies (~1.5 s) to the default whole-Earth view: lon 15°, lat 35°, 28 000 km, north-up. This is the view `createViewer.ts:185-188` sets on a first visit. | Releases the lock first, then flies. |
| Locate me | Asks for the device position (browser geolocation; prompts once), then flies to ~500 km above it, north-up, looking down. | Releases the lock first, then flies. |

- Locate errors (denied, unavailable, timeout) show a short HUD message beside the button for a few
  seconds (e.g. `LOCATION DENIED`). There is no blocking dialog, and nothing persists.
- **Keyboard:** `0` = home, `R` = north-up + level. Added to the HELP overlay (`app/HelpOverlay.tsx`) and
  `docs/CONTROLS.md`. Zoom stays on Q / E.
- **Placement:** a vertical stack on the right edge where it fits (phone portrait). It must never overlap
  the right stack (selection panels), the transport bar, the compact chip or an open compact sheet, and the
  right stack is never shortened to make room. Where the right edge is taken (desktop with telemetry +
  passes open, `styles/telemetry.css:19-20`; a landscape phone, which also uses the compact layout,
  `core/ui/useCompactLayout.ts:10`), the stack may become a horizontal row in the bottom-right band, next to
  the launchers / dock. On the phone it hides while a sheet is open. It belongs to `.hud-layer`, so HIDE / U
  hides it with the rest of the HUD. Exact position, icons and sizing are `@hud-designer`'s call (targets
  ≥ 44 px).

**Architecture** (Cesium out of React; same shape as `followStore` → `GlobeFollow`):

- `core/engine/CameraRig` gains the camera operations: `flyHome()`, `zoomStep(±1)` (an impulse that
  `update()` plays out over a few frames, allocation-free), `levelNorth()` and `flyTo(lonDeg, latDeg,
  heightM)`. Each operation cancels a running flight before starting its own.
- A small non-React command store in `core/ui/` (e.g. `cameraStore`): the HUD calls `request(command)`;
  the globe wiring in `app/globe/` subscribes and forwards to the rig, releasing the follow lock through
  `useFollow` where the table above says so. The subscription is part of the globe's teardown, like every
  other wiring in `createGlobe`.
- Compass heading: the frame loop publishes the camera heading to a `core/ui` store **only when it changed
  by ≥ 1°** (a number compare per frame, no allocation, no set otherwise). The compass component reads
  that store and rotates the needle with a CSS transform.
- Geolocation stays in the HUD layer (app/ or core/ui), not the engine. The passes slice's GPS button
  (`features/passes/PassesPanel.tsx:137-158`) may share a `core/ui` helper. That is the builder's call; no
  slice may import it from another slice.

### 3. Legend for every domain that is on

- **Desktop left rail:** the pictures of **every** visible domain, stacked in tab order (CATALOG, VESSELS,
  AIRCRAFT), then LAYERS. The rail already scrolls (`styles/rail.css:31-33`).
- **Phone dock:** one picture button, shown while any domain is on. Its label is the domain's name when
  exactly one domain is on (CATALOG / VESSELS / AIRCRAFT, as today) and `LEGEND` when two or more are on.
  Its sheet stacks the same pictures in tab order, and every section's heading is visible (today the
  sheet hides the picture's first `.hud-title`, `styles/sheet.css:42`).
- `useRailPicture()` (one entry or null) becomes a list of the visible domains' pictures. The rule stays in
  one place, shared by the rail, the dock and the sheet.
- **Foldable sections** (owner's pick, 2026-11-18): each stacked section's heading (CATALOG / VESSELS /
  AIRCRAFT) is a toggle button that folds or unfolds that section, on the phone sheet and the desktop rail
  alike. Fold state is per domain, remembered in this browser (localStorage, through `core/ui`), and
  sections start unfolded. A folded section keeps its heading row and live count visible. When exactly one
  domain is on, its section cannot be folded (there is nothing to make room for), and the heading renders
  as today. Why: CATALOG alone (search + 12 group rows, > 500 px on touch, `styles/rail.css:292-295`) is
  taller than the whole phone sheet (55dvh, `styles/tokens.css:100,113`), and it comes first in tab order.
- Focus semantics are unchanged everywhere else: selection panels / details sheet, tap priority, follow
  target and the FOLLOW button still act on the focused domain.
- **A catalog search pick focuses ORBITAL**, exactly like a globe tap on a satellite
  (`app/globe/tapRouting.ts:49` calls `setMode` before `select`). Today the search
  (`features/catalog/CatalogPanel.tsx:96-98`) only selects, which never mattered because CATALOG rendered
  only while ORBITAL was focused. Once CATALOG is stacked under another focused domain it would otherwise
  select a satellite whose details never appear. Follow behaves as it does for a tap.

### 4. Time bar only with a satellite picked

- **Rule** (one place, replacing `modeStore.transportVisible`):
  `visible = ORBITAL layer on && (a satellite is selected || sim time is not live)`.
  "Not live" is `isSimLive` false: warped, paused or scrubbed off NOW. That second clause keeps the way
  back to NOW on screen after a deselect while warped.
- Applies to both layouts, and to everything that travels with the bar today: the bar itself, the
  status-line sim-rate readout (`app/StatusLine.tsx:17,37-39`), the time keys (`app/globe/globeKeys.ts`
  `timeControlsActive`) and the app root's `has-transport` class (`App.tsx:57`).
- The rule depends on three stores (mode, satellite selection, sim clock), so it moves out of
  `modeStore` into its own `core/ui` module with a reactive hook (React, via `useSimLive`) and a
  non-reactive twin (keys, wiring).
- The existing safety net stays tied to ORBITAL turning off: when ORBITAL hides while sim time is off NOW,
  reset to NOW (`app/globe/layerSync.ts:113-119`). A deselect alone never hides the bar while off NOW, so
  it never needs a reset.

## Verification

- `npm run lint && npm test` green. New unit tests: the transport rule (each clause), the colour migration
  (untouched v1 default → v2; custom kept; v2 read unchanged; garbage rejected), swatch grid ⊇ defaults,
  the visible-pictures list and the dock label, fold state (persist / parse / lone section unfoldable),
  the search pick focusing ORBITAL, the camera command store, and the compass ≥ 1° publish threshold.
- Run it (`npm run dev`) on desktop and in Chrome DevTools phone emulation. Screenshot each change; drive
  compass / zoom / home / locate (with emulated geolocation, allowed and denied) both free and follow-locked;
  confirm no camera snap-back; watch for console errors. Take a heap snapshot after a few minutes of
  nav use to look for retained Cesium objects (`@cesium-engine` checklist).
- The soft-keyboard case (1a) cannot be emulated: the owner checks it on the phone after the deploy. The PR
  says so.

## Left to the builder

- Exact shades (keeping the meaning→hue mapping), grid column count, swatch names.
- Nav stack position, icons, sizes; the locate message's wording and duration.
- Zoom factor, flight durations, locate altitude (≈ 500 km is a starting point).
- Whether the passes GPS button shares the new geolocation helper.

## Calls made without asking (owner, please check)

1. The inline picker replaces the popover on desktop too (one code path; the popover's placement and detach
   logic was the bug).
2. Stored colours that equal the old default migrate to the new one; colours you picked stay, so your
   current dim-amber rows remain until RESET.
3. Satellite colours: LEO ice, MEO lime, GEO gold, HEO pink; amber is now selection-only.
4. The dock label stays the domain's own name with one domain on; it becomes `LEGEND` only with two or more.
5. The legend stacks in tab order (ORBITAL, MARITIME, AIRSPACE), not "last focused first", so it never
   reshuffles under your thumb.
6. Keys: `0` home, `R` north-up + level.
7. The new time-bar rule applies on desktop too.
8. Picking a satellite from the catalog search switches focus to ORBITAL, like tapping it on the globe.
9. Swatch grid: at most 8 columns (neighbouring hue families merged) so swatches stay ≥ 32 px on a phone.
10. Where the right edge is full (desktop with satellite panels open, landscape phone), the nav controls
    become a row in the bottom-right corner instead of shrinking the panels.
11. Folded legend sections start unfolded and are remembered per domain; a lone section cannot fold.
