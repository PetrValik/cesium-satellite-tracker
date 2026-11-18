# Controls & usage

Orbital Ops is a fullscreen globe with a corner-anchored avionics HUD. Press
**H** or **?** in the app for the built-in cheat sheet; this page is the long
form.

> Ships and aircraft are **live** (wall clock) — they never time-travel. Only
> satellites follow **simulation time**.

## OPS modes

An MFD-style tab strip toggles each domain's layer (amber = on); any subset can
render on the globe at once. Turning a domain on also focuses it: the focused
mode drives the right-stack panels and which layer clicks resolve to first. The
left rail shows the picture of every domain that is on, stacked in tab order
(CATALOG, VESSELS, AIRCRAFT) above LAYERS. On a phone, one dock button opens them
all: it carries the domain's name when one is on and LEGEND when two or more
are. With two or more on, tap a section heading to fold it to one row with its
live count (SUSP for vessels and aircraft while sim time is off NOW). Folds are
remembered per domain in this browser, and a lone section never folds. Turning the focused domain off moves focus to the first
domain still on (tab order). Keys `1` / `2` / `3` work like the tabs; hiding a
layer drops any selection in it. Clicking an object from another domain jumps to
its mode automatically.

| Mode | Key | Left rail | Right stack | Globe emphasis |
|---|---|---|---|---|
| **ORBITAL** | `1` | CATALOG — 12 satellite groups (toggle to load) + name/NORAD search (SEARCH UNAVAILABLE when the API does not answer) | Telemetry + Passes/sky plot for the selected satellite | Constellation points colored by orbit class (LEO/MEO/GEO/HEO); selected sat gets orbit path, ground track, and visibility footprint |
| **MARITIME** | `2` | MARITIME PICTURE — live vessel counts by type (AIS OFFLINE without a key, AIS UNAVAILABLE while a poll fails) | Ship detail panel for the selected vessel | AIS vessels colored by type, dead-reckoned along their course |
| **AIRSPACE** | `3` | AIR PICTURE — live aircraft count + feed age, altitude-band and category filters | Aircraft detail panel for the selected aircraft | ADS-B aircraft: hue by category (civil / cargo / military), shade by altitude band, flat grey on the ground; dead-reckoned between polls |

The layer toggles (below) sit under the mode content in every mode. Every
legend swatch and colored label in the panels (vessel type, aircraft category,
orbit class) uses the same colors as the globe, including your COLORS choices.

Default colours mean the same thing in every domain: red military, blue civil
aircraft / passenger vessels, green cargo, violet tanker, teal fishing, pink
high-speed craft, grey other (and aircraft on the ground). Satellites: LEO ice,
MEO lime, GEO gold, HEO pink. Amber is never a default; it marks the selected or
followed object. Colours you changed yourself survive the switch to these
defaults; RESET in COLORS restores the defaults. In COLORS, tap a chip to open
its picker under that row: pick a swatch, or type a hex value (`#RRGGBB` or
`RRGGBB`; Enter or leaving the field applies it). The picker closes on a swatch
pick, ESC, or the chip again.

## Mouse

| Input | Action |
|---|---|
| DRAG | Rotate the globe / orbit the followed object |
| WHEEL | Zoom |
| CLICK OBJECT | Select (ships & aircraft also lock the camera) |
| CLICK EMPTY | Deselect |

Clicking an object that belongs to another domain switches to that mode and
selects it. Picking a satellite from the CATALOG search does the same: focus moves to
ORBITAL and its telemetry opens. Clicking empty space deselects **within the current mode only**.

## Keyboard

### Camera

| Key | Action |
|---|---|
| W A S D / ARROWS | Rotate view / orbit target |
| Q / E | Zoom in / out |
| 0 | Fly to the whole-Earth view (HOME button); releases a follow-lock |
| R | Turn north-up and look straight down (compass button); keeps a follow-lock |
| F | Toggle camera follow-lock on the selection |
| ESC | Close help → COLORS → open sheet, then release follow-lock, then deselect |

### Modes & time

| Key | Action |
|---|---|
| 1 / 2 / 3 | Toggle the ORBITAL / MARITIME / AIRSPACE layer (like the tabs) |
| SPACE | Play / pause simulation time (while the time bar shows) |
| , / . | Slower / faster time warp (while the time bar shows) |
| N | Reset simulation to NOW (while the time bar shows) |
| H or ? | Toggle the controls help |

### HUD

| Key | Action |
|---|---|
| U | Hide / show all controls (same as the HIDE button) |
| ESC | While the controls are hidden: show them again (and nothing else) |

Keyboard shortcuts are ignored while typing in an input (search, observer
coordinates).

## Globe navigation

Four HUD buttons move the camera; keys do the same.

| Control | Key | Tap does | While follow-locked |
|---|---|---|---|
| Compass | `R` | The needle shows the camera heading. Turns the view north-up and looking straight down, keeping the point under the screen centre | Levels the follow camera around the target; the lock stays |
| + / − | `Q` / `E` | Smooth zoom step, roughly halving / doubling the distance | Zooms the follow range |
| HOME | `0` | Flies to the whole-Earth view (lon 15°, lat 35°, 28 000 km, north-up) | Releases the lock first, then flies |
| LOCATE | — | Asks for your position (the browser prompts once), then flies to about 500 km above it, north-up | Releases the lock first, then flies |

On desktop the buttons are a column under the mode tabs: at the right edge, or
beside the satellite / vessel / aircraft panels while those are open. On a phone
in portrait they are a column at the top right of the bottom cluster; in
landscape or on a short screen they are a row above the dock. On a phone they
hide while a sheet is open. A failed locate shows `LOCATION DENIED`, `LOCATION
UNAVAILABLE`, `LOCATION TIMED OUT` or `NO LOCATION IN THIS BROWSER` beside the
button for about 4 s. Keys `0` and `R` work while the controls are hidden.

## Camera follow-lock

Follow-lock makes the camera ride the current selection.

- **Auto-lock:** selecting a **ship** or **aircraft** (by click) locks the
  camera onto it immediately.
- **Satellites:** selecting a satellite does **not** auto-lock; press **F** to
  ride it. F toggles the lock and only acts when the current mode has a
  selection. The FOLLOW button does the same.
- **ESC is staged, one layer per press:** the help overlay closes first, then
  an open colour picker, then the COLORS panel, then an open phone sheet (legend / layers / details);
  otherwise if the camera is following it releases the lock (keeping the
  selection); otherwise it deselects. So with nothing open, one ESC releases
  the lock and a second ESC deselects. While the controls are hidden, ESC only
  shows them again (see below).
- While following, DRAG orbits the followed object instead of the globe.

## Hide controls (clean globe)

HIDE takes the whole HUD off the globe — status line, layer tabs, side
panels, dock and sheets, selection chip, transport bar, navigation buttons
and the HELP / COLORS launchers. Open sheets and the HELP / COLORS dialogs close with it.

- **Where:** the HIDE button sits next to HELP / COLORS on desktop and at the
  end of the dock on phones; on a keyboard, **U** toggles both ways.
- **While hidden** only a small eye button (bottom-left) and the map
  attribution stay on screen. Tap or click it, press **U**, or press **ESC**
  to bring the controls back — ESC while hidden only shows them; it does not
  release the follow-lock or deselect.
- The globe stays live: drag, pinch, tap-select and follow-lock keep working
  and simulation time keeps running. Showing the controls again reflects
  whatever was selected meanwhile.
- Opening HELP (**H** / **?**) while hidden brings the controls back with it.
- Not persisted: a reload always opens with the controls showing.

## Layer toggles

The LAYERS panel is present in every mode. Each row shows a live count, and
the BASEMAP row switches between MAP, TOPO and SAT imagery.

| Layer | Default |
|---|---|
| SATELLITES | on |
| VESSELS (AIS ships) | off |
| AIRCRAFT (ADS-B) | off |
| LAUNCH SITES | on |
| MAJOR PORTS | off |

The SATELLITES / VESSELS / AIRCRAFT rows are the same layers as the tabs, but
turning one on from here does not move focus. Turning off the focused domain
moves focus to the first domain still on, exactly like its tab. Hiding a layer
also drops any selection in that layer. While sim time is off NOW the live rows
read SUSP. Mode and layer choices persist in `localStorage`.

## Observer & pass prediction (ORBITAL)

With a satellite selected, the PASSES panel predicts AOS/LOS windows above 5°
elevation for your observer over the **next 24 h** and draws the selected pass
on a polar azimuth/elevation sky plot.

- **Observer:** edit latitude/longitude in the OBS fields (Enter or blur to
  commit), or press **GPS** to use browser geolocation; a denied permission or a
  failed fix is reported under the fields. The default observer is Prague
  (50.08, 14.44). The observer persists in `localStorage`.
- **Pass list:** each row shows AOS time, max elevation, and duration. The **→**
  button jumps sim time to that pass's AOS, sets warp to ×10, and starts
  playing, so you can watch the pass unfold.
- Predictions recompute automatically when you change satellite or observer, or
  when sim time is warped/scrubbed outside the current 24 h window.

## Simulation time (transport bar)

One sim clock drives satellite motion, the orbit/ground-track geometry, and the
Cesium day/night terminator. The bottom transport bar controls it:

| Control | Action |
|---|---|
| Play / pause (`SPACE`) | Start/stop advancing sim time |
| Rate buttons (`,` / `.`) | Warp multiplier: `-60` (rewind), `1`, `10`, `60`, `600`, `3600` |
| Scrub slider | Jump within ±12 h of now (pauses playback) |
| NOW (`N`) | Reset to the current wall-clock time, rate ×1, playing |
| UTC readout | Current sim time in UTC |

The bar shows while the SATELLITES layer is on **and** a satellite is selected.
It also stays while sim time is away from NOW (warped, paused or scrubbed), so a
deselect never hides the way back; once sim time is at NOW with nothing selected,
it hides. Turning SATELLITES off while away from NOW resets sim time to NOW. The
time keys and the status line's SIM readout come and go with the bar.

The top status line mirrors this: tracked-object count, TLE data age, and, while
the bar shows, the current SIM rate (or HOLD when paused).
