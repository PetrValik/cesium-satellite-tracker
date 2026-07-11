# Controls & usage

Orbital Ops is a fullscreen globe with a corner-anchored avionics HUD. Press
**H** or **?** in the app for the built-in cheat sheet; this page is the long
form.

> Ships and aircraft are **live** (wall clock) — they never time-travel. Only
> satellites follow **simulation time**.

## OPS modes

An MFD-style tab strip switches which domain the HUD focuses on. All layers can
render on the globe at once; the mode drives which left-rail and right-stack
panels are shown, and which layer clicks resolve to first. Keys `1` / `2` / `3`
switch modes (and clear the current selection); clicking an object from another
domain jumps to its mode automatically.

| Mode | Key | Left rail | Right stack | Globe emphasis |
|---|---|---|---|---|
| **ORBITAL** | `1` | CATALOG — 12 satellite groups (toggle to load) + name/NORAD search | Telemetry + Passes/sky plot for the selected satellite | Constellation points colored by orbit class (LEO/MEO/GEO/HEO); selected sat gets orbit path, ground track, and visibility footprint |
| **MARITIME** | `2` | MARITIME PICTURE — live vessel counts by type (AIS OFFLINE without a key) | Ship detail panel for the selected vessel | AIS vessels colored by type, dead-reckoned along their course |
| **AIRSPACE** | `3` | AIR PICTURE — live aircraft count + feed age | Aircraft detail panel for the selected aircraft | ADS-B aircraft colored by altitude band, dead-reckoned between polls |

The layer toggles (below) sit under the mode content in every mode.

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
| ESC | Release follow-lock, then deselect |

### Modes & time

| Key | Action |
|---|---|
| 1 / 2 / 3 | ORBITAL / MARITIME / AIRSPACE |
| SPACE | Play / pause simulation time |
| , / . | Slower / faster time warp |
| N | Reset simulation to NOW |
| H or ? | Toggle the controls help |

Keyboard shortcuts are ignored while typing in an input (search, observer
coordinates).

## Camera follow-lock

Follow-lock makes the camera ride the current selection.

- **Auto-lock:** selecting a **ship** or **aircraft** (by click) locks the
  camera onto it immediately.
- **Satellites:** selecting a satellite does **not** auto-lock; press **F** to
  ride it. F toggles the lock and only acts when the current mode has a
  selection. The FOLLOW button does the same.
- **ESC is staged:** if the help overlay is open it closes; otherwise if the
  camera is following it releases the lock (keeping the selection); otherwise it
  deselects. So one ESC releases the lock, a second ESC deselects.
- While following, DRAG orbits the followed object instead of the globe.

## Layer toggles

The LAYERS panel is present in every mode and toggles globe overlays
independently of the active mode. Each row shows a live count.

| Layer | Default |
|---|---|
| VESSELS (AIS ships) | on |
| AIRCRAFT (ADS-B) | on |
| LAUNCH SITES | on |
| MAJOR PORTS | off |

Hiding the vessels or aircraft layer also drops any selection in that layer.
Mode and layer choices persist in `localStorage`.

## Observer & pass prediction (ORBITAL)

With a satellite selected, the PASSES panel predicts AOS/LOS windows above 5°
elevation for your observer over the **next 24 h** and draws the selected pass
on a polar azimuth/elevation sky plot.

- **Observer:** edit latitude/longitude in the OBS fields (Enter or blur to
  commit), or press **GPS** to use browser geolocation. The default observer is
  Prague (50.08, 14.44). The observer persists in `localStorage`.
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
