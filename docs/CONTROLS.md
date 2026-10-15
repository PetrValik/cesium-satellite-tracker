# Controls & usage

Orbital Ops is a fullscreen globe with a corner-anchored avionics HUD. Press
**H** or **?** in the app for the built-in cheat sheet; this page is the long
form.

> Ships and aircraft are **live** (wall clock) — they never time-travel. Only
> satellites follow **simulation time**.

## OPS modes

An MFD-style tab strip toggles each domain's layer (amber = on); any subset can
render on the globe at once. Turning a domain on also focuses it: the focused
mode drives which left-rail and right-stack panels are shown, and which layer
clicks resolve to first. Turning the focused domain off moves focus to the first
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

## Mouse

| Input | Action |
|---|---|
| DRAG | Rotate the globe / orbit the followed object |
| WHEEL | Zoom |
| CLICK OBJECT | Select (ships & aircraft also lock the camera) |
| CLICK EMPTY | Deselect |

Clicking an object that belongs to another domain switches to that mode and
selects it. Clicking empty space deselects **within the current mode only**.

## Keyboard

### Camera

| Key | Action |
|---|---|
| W A S D / ARROWS | Rotate view / orbit target |
| Q / E | Zoom in / out |
| F | Toggle camera follow-lock on the selection |
| ESC | Close help → COLORS → open sheet, then release follow-lock, then deselect |

### Modes & time

| Key | Action |
|---|---|
| 1 / 2 / 3 | Toggle the ORBITAL / MARITIME / AIRSPACE layer (like the tabs) |
| SPACE | Play / pause simulation time (ORBITAL layer on) |
| , / . | Slower / faster time warp (ORBITAL layer on) |
| N | Reset simulation to NOW |
| H or ? | Toggle the controls help |

### HUD

| Key | Action |
|---|---|
| U | Hide / show all controls (same as the HIDE button) |
| ESC | While the controls are hidden: show them again (and nothing else) |

Keyboard shortcuts are ignored while typing in an input (search, observer
coordinates).

## Camera follow-lock

Follow-lock makes the camera ride the current selection.

- **Auto-lock:** selecting a **ship** or **aircraft** (by click) locks the
  camera onto it immediately.
- **Satellites:** selecting a satellite does **not** auto-lock; press **F** to
  ride it. F toggles the lock and only acts when the current mode has a
  selection. The FOLLOW button does the same.
- **ESC is staged, one layer per press:** the help overlay closes first, then
  the COLORS panel, then an open phone sheet (catalog / layers / details);
  otherwise if the camera is following it releases the lock (keeping the
  selection); otherwise it deselects. So with nothing open, one ESC releases
  the lock and a second ESC deselects. While the controls are hidden, ESC only
  shows them again (see below).
- While following, DRAG orbits the followed object instead of the globe.

## Hide controls (clean globe)

HIDE takes the whole HUD off the globe — status line, layer tabs, side
panels, dock and sheets, selection chip, transport bar and the HELP / COLORS
launchers. Open sheets and the HELP / COLORS dialogs close with it.

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

The top status line mirrors this: tracked-object count, TLE data age, and the
current SIM rate (or HOLD when paused).
