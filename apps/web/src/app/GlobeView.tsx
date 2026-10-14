/**
 * GlobeView — the composition root of everything on the globe.
 *
 * One engine effect owns the Cesium viewer, all layers, the propagation
 * worker's wiring, the camera rig, keyboard input, picking, and the render
 * loop.
 * The moving parts and their time bases:
 *
 * - SIM TIME (warpable): the rAF loop advances the sim clock, syncs the
 *   viewer clock, interpolates the constellation between worker snapshots,
 *   and propagates the selected satellite per frame on the main thread.
 * - WALL TIME (live): ships and aircraft dead-reckon from their last real
 *   report — they never time-travel with the sim. Whenever sim time leaves
 *   NOW (warp/pause/scrub) the live layers suspend: hidden, selection kept.
 *
 * All reactivity inside goes through zustand `subscribe` (transient, no
 * re-renders). The engine effect re-runs only when `engineEpoch` bumps: a
 * lost WebGL context (mobile backgrounding / GPU pressure) cannot be
 * restored in place, so recovery tears the whole engine down and builds it
 * again on a fresh canvas. The propagation worker is NOT part of that: it
 * lives for the component's lifetime (its hashed script URL may no longer
 * be served after a deploy), and each engine epoch only re-wires its
 * message listener and re-sends the catalog. Cleanup tears down in reverse
 * order and every Cesium access is isDestroyed-guarded.
 */
import { useEffect, useRef, useState } from 'react'
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Cartesian2 } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { Cartesian3 } from 'cesium'
import { CameraRig } from '../core/engine/CameraRig'
import { aircraftIcon, shipIcon } from '../core/engine/icons'
import { WorldDecal } from '../core/engine/WorldDecal'
import {
  applyRenderDensity,
  createOrbitalViewer,
  destroyOrbitalViewer,
  setViewerBasemap,
  syncViewerClock,
} from '../core/engine/createViewer'
import {
  drawingBufferRatio,
  PICK_LIMIT,
  pickWindowCssPx,
  pickWindowPx,
} from '../core/engine/displayDensity'
import { isSimLive, simClock, SIM_RATES } from '../core/sim/simClock'
import { useFollow } from '../core/ui/followStore'
import { useHud } from '../core/ui/hudStore'
import { usePrefs } from '../core/ui/prefsStore'
import { useSheet } from '../core/ui/sheetStore'
import { ConstellationLayer } from '../features/constellation/ConstellationLayer'
import { GroundTrackWindow } from '../features/tracking/GroundTrackWindow'
import { TrackingVisuals } from '../features/tracking/TrackingVisuals'
import { SHIP_TYPES } from '@orbital-ops/shared'
import { AircraftLayer } from '../features/airspace/AircraftLayer'
import { AIRCRAFT_CATEGORIES, categoryOf } from '../features/airspace/aircraftCategory'
import { ALT_BANDS, bandOf, useAircraft, type AircraftState } from '../features/airspace/aircraftStore'
import { LaunchSitesLayer } from '../features/infra/LaunchSitesLayer'
import { PortsLayer } from '../features/infra/PortsLayer'
import { ShipsLayer } from '../features/maritime/ShipsLayer'
import { useShips, type ShipsState } from '../features/maritime/shipsStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useTelemetry } from '../features/tracking/telemetryStore'
import { useMode } from '../core/ui/modeStore'
import launchSites from '../data/launchSites.json'
import ports from '../data/ports.json'
import {
  classifyOrbit,
  createSatrec,
  footprintRadiusM,
  gmstAt,
  orbitalPeriodMinutes,
  propagateEcef,
  sampleOrbitRingEci,
} from '../lib/orbital'
import type { SatRec } from 'satellite.js'
import type { WorkerRequest, WorkerResponse } from '../lib/protocol'
import { deselectInMode, hasSelectionInMode, resolveTap } from './selectionMode'

/** Wall-clock ms between constellation ticks; tighter under heavy time warp. */
function tickIntervalMs(rate: number): number {
  return Math.abs(rate) > 60 ? 250 : 1000
}

const TELEMETRY_INTERVAL_MS = 200

/** A lost WebGL context gets this long to come back by itself before the engine is rebuilt anyway. */
const CONTEXT_RESTORE_GRACE_MS = 1500
/** More than this many rebuilds within RECOVERY_WINDOW_MS → stop and show the error panel. */
const MAX_RECOVERIES = 3
const RECOVERY_WINDOW_MS = 60_000
/** A rebuild whose viewer failed to construct is retried after this pause (GPU not back yet). */
const REBUILD_RETRY_DELAY_MS = 1000

/**
 * Logs one engine rebuild (performance.now() stamps) and reports whether it
 * is within budget — at most MAX_RECOVERIES per RECOVERY_WINDOW_MS. One
 * budget for both context-loss recovery and the retry of a failed rebuild.
 */
function takeRecoverySlot(log: { current: number[] }, nowMs: number): boolean {
  const recent = log.current.filter((t) => nowMs - t < RECOVERY_WINDOW_MS)
  recent.push(nowMs)
  log.current = recent
  return recent.length <= MAX_RECOVERIES
}

/** `init`: the first viewer never came up. `lost`: a running renderer died and rebuilds ran out. */
interface EngineError {
  kind: 'init' | 'lost'
  message: string
}

export function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [engineError, setEngineError] = useState<EngineError | null>(null)
  /** Bumped to tear the engine down and rebuild it (context-loss recovery). */
  const [engineEpoch, setEngineEpoch] = useState(0)
  /** Last rAF timestamp, kept across rebuilds so sim time loses no wall time. */
  const lastFrameRef = useRef(0)
  /** performance.now() of recent rebuilds (loop guard). */
  const recoveryLogRef = useRef<number[]>([])
  /** A follow lock that was active when a rebuild started, re-engaged after it. */
  const resumeFollowRef = useRef(false)
  /** The SGP4 propagation worker, owned by the effect below (component lifetime). */
  const workerRef = useRef<Worker | null>(null)

  // Propagation worker: created ONCE per mount, never per engine epoch. A
  // context-loss rebuild in a PWA tab left open across a deploy would
  // otherwise re-fetch the old content-hashed worker URL, which the new
  // service worker no longer caches and the server answers with index.html.
  // Declared before the engine effect so its setup runs first (React runs
  // effects in declaration order) and the engine effect finds it.
  useEffect(() => {
    const worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
      type: 'module',
    })
    const onWorkerError = (e: Event) => {
      // Fires for a script that failed to load (404 / HTML served for the
      // hashed URL) as well as an uncaught error inside the worker.
      const detail = e instanceof ErrorEvent && e.message ? `: ${e.message}` : ''
      console.error(
        `[propagation.worker] worker failed${detail} — satellite positions will not update`,
        e,
      )
    }
    const onWorkerMessageError = (e: MessageEvent) => {
      console.error('[propagation.worker] a message from the worker could not be deserialized', e)
    }
    worker.addEventListener('error', onWorkerError)
    worker.addEventListener('messageerror', onWorkerMessageError)
    workerRef.current = worker
    return () => {
      if (workerRef.current === worker) workerRef.current = null
      worker.removeEventListener('error', onWorkerError)
      worker.removeEventListener('messageerror', onWorkerMessageError)
      worker.terminate()
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const worker = workerRef.current
    // The worker effect above always runs first; the guard only keeps a
    // viewer from being built that nothing could feed.
    if (!container || !worker) return

    let viewer
    try {
      viewer = createOrbitalViewer(container, usePrefs.getState().basemap)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Viewer.js (1.138) appends its .cesium-viewer div before building the
      // widget and never removes it on a throw — a retry would stack under it.
      container.replaceChildren()
      if (engineEpoch === 0 || !takeRecoverySlot(recoveryLogRef, performance.now())) {
        // Init failure is only observable from inside this effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setEngineError({ kind: engineEpoch === 0 ? 'init' : 'lost', message })
        return
      }
      // A rebuild after context loss: on mobile the GPU is often not back
      // yet. Try once more on a fresh epoch after a pause — never while
      // hidden (same rule as scheduleRecovery); the budget above caps it.
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      const armRetry = () => {
        if (retryTimer !== undefined || document.hidden) return
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          // Went hidden during the pause: the visibilitychange listener re-arms.
          if (!document.hidden) setEngineEpoch((n) => n + 1)
        }, REBUILD_RETRY_DELAY_MS)
      }
      armRetry()
      document.addEventListener('visibilitychange', armRetry)
      return () => {
        if (retryTimer !== undefined) clearTimeout(retryTimer)
        document.removeEventListener('visibilitychange', armRetry)
      }
    }

    // Dev-only escape hatch for live debugging in the browser console.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __opsViewer?: unknown }).__opsViewer = viewer
    }

    // Reopen where the user left off (free camera only; follow overrides).
    const savedCamera = usePrefs.getState().lastCamera
    if (savedCamera !== null) {
      viewer.camera.setView({
        destination: new Cartesian3(savedCamera.x, savedCamera.y, savedCamera.z),
        orientation: {
          heading: savedCamera.headingRad,
          pitch: savedCamera.pitchRad,
          roll: savedCamera.rollRad,
        },
      })
    }

    const constellation = new ConstellationLayer(viewer.scene)
    const tracking = new TrackingVisuals(viewer)
    const rig = new CameraRig(viewer)
    const shipsLayer = new ShipsLayer(viewer.scene)
    const aircraftLayer = new AircraftLayer(viewer.scene)
    // World-oriented flat markers for the selected ship/aircraft: the
    // camera-facing layer billboard is hidden while selected and this decal
    // (lying in the map plane, nose along the course) represents it instead.
    const shipDecal = new WorldDecal(viewer.scene, shipIcon(), '#ffb454')
    const aircraftDecal = new WorldDecal(viewer.scene, aircraftIcon(), '#ffb454')
    const launchSitesLayer = new LaunchSitesLayer(viewer.scene, launchSites)
    const portsLayer = new PortsLayer(viewer.scene, ports)
    const post = (msg: WorkerRequest) => worker.postMessage(msg)

    // --- live domain layers: data (type/band filtered) + layer visibility ---
    const filteredShips = (s: ShipsState) =>
      s.activeTypes.size === SHIP_TYPES.length
        ? s.ships
        : s.ships.filter((ship) => s.activeTypes.has(ship.shipType))
    const filteredAircraft = (s: AircraftState) => {
      const allBands = s.activeBands.size === ALT_BANDS.length
      const allCategories = s.activeCategories.size === AIRCRAFT_CATEGORIES.length
      if (allBands && allCategories) return s.aircraft
      return s.aircraft.filter(
        (a) =>
          (allBands || s.activeBands.has(bandOf(a))) &&
          (allCategories || s.activeCategories.has(categoryOf(a))),
      )
    }

    shipsLayer.setShips(filteredShips(useShips.getState()))
    aircraftLayer.setAircraft(filteredAircraft(useAircraft.getState()))
    // A rebuild (or HMR) mounts with a selection already in the stores; the
    // subscriptions below only see changes, so apply it once here.
    shipsLayer.setSelected(useShips.getState().selectedMmsi)
    aircraftLayer.setSelected(useAircraft.getState().selectedIcao)

    // Ships/aircraft dead-reckon on WALL time, so once the sim clock is
    // warped, paused, or scrubbed away from now their positions are
    // meaningless against the scene. All ships/aircraft visibility routes
    // through this one gate: (user layer toggle) AND (clock live).
    let clockLive = isSimLive(simClock.get())
    const applyLiveVisibility = () => {
      const { shipsVisible, aircraftVisible } = useMode.getState()
      shipsLayer.setVisible(shipsVisible && clockLive)
      aircraftLayer.setVisible(aircraftVisible && clockLive)
      if (!clockLive) {
        // The selected-object decals suspend too (their per-frame updates
        // in the render loop are skipped while not live). Deliberately NOT
        // clearing the ship/aircraft selection here — unlike a user layer
        // toggle, a warp-driven hide must restore everything (selection,
        // follow lock, decal) when time returns to NOW.
        shipDecal.hide()
        aircraftDecal.hide()
      }
    }
    applyLiveVisibility()
    constellation.setVisible(useMode.getState().satellitesVisible)
    launchSitesLayer.setVisible(useMode.getState().launchSites)
    portsLayer.setVisible(useMode.getState().ports)

    // --- user palettes (persisted prefs) ---
    const applyPalettes = () => {
      const { colors } = usePrefs.getState()
      aircraftLayer.setPalette(colors.aircraft)
      shipsLayer.setPalette(colors.ships)
      constellation.setPalette(colors.satellites)
      // Live layers tint at set time — re-feed to recolor.
      aircraftLayer.setAircraft(filteredAircraft(useAircraft.getState()))
      shipsLayer.setShips(filteredShips(useShips.getState()))
    }
    applyPalettes()
    const unsubPrefs = usePrefs.subscribe((state, prev) => {
      if (state.colors !== prev.colors) applyPalettes()
      if (state.basemap !== prev.basemap) setViewerBasemap(viewer, state.basemap)
    })

    const unsubShips = useShips.subscribe((state, prev) => {
      if (state.ships !== prev.ships || state.activeTypes !== prev.activeTypes) {
        shipsLayer.setShips(filteredShips(state))
      }
      if (state.selectedMmsi !== prev.selectedMmsi) {
        shipsLayer.setSelected(state.selectedMmsi)
        if (state.selectedMmsi !== null) {
          // Selecting a vessel locks the camera onto it (the ask: click → fly & ride).
          useFollow.getState().setFollowing(true)
          engageFollow()
        } else {
          shipDecal.hide()
          if (useMode.getState().mode === 'maritime') useFollow.getState().setFollowing(false)
        }
      }
    })
    const unsubAircraft = useAircraft.subscribe((state, prev) => {
      if (
        state.aircraft !== prev.aircraft ||
        state.activeBands !== prev.activeBands ||
        state.activeCategories !== prev.activeCategories
      ) {
        aircraftLayer.setAircraft(filteredAircraft(state))
      }
      if (state.selectedIcao !== prev.selectedIcao) {
        aircraftLayer.setSelected(state.selectedIcao)
        if (state.selectedIcao !== null) {
          useFollow.getState().setFollowing(true)
          engageFollow()
        } else {
          aircraftDecal.hide()
          if (useMode.getState().mode === 'airspace') useFollow.getState().setFollowing(false)
        }
      }
    })
    const unsubFollow = useFollow.subscribe((state, prev) => {
      if (state.following === prev.following) return
      if (state.following) engageFollow()
      else rig.unfollow()
    })
    const unsubMode = useMode.subscribe((state, prev) => {
      if (state.launchSites !== prev.launchSites) launchSitesLayer.setVisible(state.launchSites)
      if (state.ports !== prev.ports) portsLayer.setVisible(state.ports)
      if (state.satellitesVisible !== prev.satellitesVisible) {
        constellation.setVisible(state.satellitesVisible)
        // Hiding the layer with a selected satellite would leave phantom
        // tracking visuals/telemetry — drop it (applySelection cleans up
        // via the catalog subscription, mirroring the ships path below).
        if (!state.satellitesVisible) {
          useCatalog.getState().select(null)
          // The transport bar unmounts with the ORBITAL layer. A clock left
          // warped/paused would keep the live feeds suspended with no
          // visible way back — snap it to real time instead.
          if (!isSimLive(simClock.get())) simClock.get().resetToNow()
        }
      }
      if (state.shipsVisible !== prev.shipsVisible) {
        applyLiveVisibility()
        // Hiding the layer with a followed/selected vessel would leave a
        // phantom selection — drop it. (User toggles only: warp-driven
        // hides inside applyLiveVisibility keep the selection alive.)
        if (!state.shipsVisible) useShips.getState().select(null)
      }
      if (state.aircraftVisible !== prev.aircraftVisible) {
        applyLiveVisibility()
        if (!state.aircraftVisible) useAircraft.getState().select(null)
      }
    })

    // --- selected satellite (propagated on the main thread every frame) ---
    let selectedSatrec: SatRec | null = null
    let selectedName = ''
    let groundWindow: GroundTrackWindow | null = null
    let trackAnchorMs = 0
    let trackPeriodMs = 0

    // --- camera follow-lock targets ---
    const DEG = Math.PI / 180
    const followSatPos = new Cartesian3()
    let followSatValid = false
    let lastAltKm = 400
    const liveTargetScratch = new Cartesian3()

    /**
     * Selected ship, dead-reckoned to wall-now. Bearing is true heading
     * first, COG as the fallback — the same rule as the decal pose below,
     * so the follow camera tracks exactly the point the decal occupies.
     */
    const shipTarget = (): Cartesian3 | null => {
      const st = useShips.getState()
      const ship = st.selectedMmsi === null ? undefined : st.byMmsi.get(st.selectedMmsi)
      if (!ship) return null
      const dt = Math.min((Date.now() - ship.tsMs) / 1000, 1800)
      const v = ship.sogKn >= 0.2 ? ship.sogKn * 0.514444 : 0
      const bearing = (ship.hdgDeg ?? ship.cogDeg) * DEG
      const lat = ship.latDeg + (v * Math.cos(bearing) * dt) / 111_320
      const lon =
        ship.lonDeg +
        (v * Math.sin(bearing) * dt) / (111_320 * Math.max(0.01, Math.cos(ship.latDeg * DEG)))
      return Cartesian3.fromDegrees(lon, lat, 0, undefined, liveTargetScratch)
    }

    /** Selected aircraft, dead-reckoned to wall-now. */
    const aircraftTarget = (): Cartesian3 | null => {
      const st = useAircraft.getState()
      const a = st.selectedIcao === null ? undefined : st.byIcao.get(st.selectedIcao)
      if (!a) return null
      const dt = Math.min((Date.now() - a.tsMs) / 1000, 900)
      const v = a.velocityMs ?? 0
      const bearing = (a.trackDeg ?? 0) * DEG
      const lat = a.latDeg + (v * Math.cos(bearing) * dt) / 111_320
      const lon =
        a.lonDeg +
        (v * Math.sin(bearing) * dt) / (111_320 * Math.max(0.01, Math.cos(a.latDeg * DEG)))
      const alt = Math.max(0, (a.altM ?? 0) + (a.verticalRateMs ?? 0) * dt)
      return Cartesian3.fromDegrees(lon, lat, alt, undefined, liveTargetScratch)
    }

    /** Point the rig at the current mode's selection (idempotent). */
    const engageFollow = () => {
      const mode = useMode.getState().mode
      if (mode === 'orbital') {
        if (selectedSatrec === null) {
          useFollow.getState().setFollowing(false)
          return
        }
        const range = Math.min(Math.max(lastAltKm * 3000, 150_000), 80_000_000)
        rig.follow(() => (followSatValid ? followSatPos : null), range)
      } else if (mode === 'maritime') {
        if (useShips.getState().selectedMmsi === null) {
          useFollow.getState().setFollowing(false)
          return
        }
        rig.follow(shipTarget, 60_000)
      } else {
        if (useAircraft.getState().selectedIcao === null) {
          useFollow.getState().setFollowing(false)
          return
        }
        rig.follow(aircraftTarget, 120_000)
      }
    }

    const refreshTrack = (epochMs: number) => {
      if (!selectedSatrec) return
      // Closed orbit ring in the inertial frame; rotated by GMST at render time.
      const ring = sampleOrbitRingEci(selectedSatrec, epochMs)
      tracking.setOrbitRing(ring.eciKm)
      trackAnchorMs = epochMs
      trackPeriodMs = orbitalPeriodMinutes(selectedSatrec) * 60_000
    }

    /** Sampled window is stale once sim time drifts past either margin. */
    const trackNeedsRefresh = (epochMs: number) =>
      epochMs > trackAnchorMs + trackPeriodMs * 0.6 || epochMs < trackAnchorMs - trackPeriodMs * 0.1

    const applySelection = (noradId: number | null) => {
      constellation.setSelected(noradId)
      // Always drop the previous satellite's visuals/telemetry first, so a
      // failed TLE can't leave them displayed under the new selection.
      selectedSatrec = null
      followSatValid = false
      groundWindow = null
      tracking.clear()
      useTelemetry.getState().clear()
      if (noradId === null) {
        if (useMode.getState().mode === 'orbital') useFollow.getState().setFollowing(false)
        return
      }
      const sat = useCatalog.getState().byId.get(noradId)
      if (!sat) return
      const satrec = createSatrec(sat.tle1, sat.tle2)
      if (!satrec) return
      selectedSatrec = satrec
      groundWindow = new GroundTrackWindow(satrec)
      selectedName = sat.name
      useTelemetry.getState().update({
        noradId,
        name: sat.name,
        orbitClass: classifyOrbit(satrec),
        periodMinutes: orbitalPeriodMinutes(satrec),
      })
      refreshTrack(simClock.get().epochMs)
      // Following a previous satellite → carry the lock over to the new one.
      if (useFollow.getState().following && useMode.getState().mode === 'orbital') engageFollow()
    }

    // --- worker wiring: bulk constellation propagation ---
    let tickBusy = false
    let lastTickWall = 0
    let workerReady = false

    // Ticks are requested ahead of display time by one tick interval of sim
    // time, so the interpolation window [prev, curr] usually brackets "now"
    // and advance() interpolates instead of extrapolating.
    const requestTick = () => {
      tickBusy = true
      const { epochMs, rate, playing } = simClock.get()
      const leadMs = playing ? tickIntervalMs(rate) * rate : 0
      post({ type: 'tick', epochMs: epochMs + leadMs })
    }

    // The worker outlives this epoch: a reply to the previous epoch's request
    // can still arrive here. Harmless — positions before this layer's first
    // `ready` are dropped by its empty billboard set, and setCatalog resets
    // the sample pair; the epoch's own `init` (sent below) ends the race.
    const onWorkerMessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        constellation.setCatalog(msg.noradIds, msg.classes)
        constellation.setSelected(useCatalog.getState().selectedId)
        workerReady = true
        requestTick()
      } else if (msg.type === 'positions') {
        constellation.updatePositions(msg.positions, msg.epochMs)
        tickBusy = false
        lastTickWall = performance.now()
      } else if (msg.type === 'error') {
        console.error('[propagation.worker]', msg.message)
        tickBusy = false
      }
    }
    worker.addEventListener('message', onWorkerMessage)

    const sendCatalog = (sats: { noradId: number; tle1: string; tle2: string }[]) => {
      workerReady = false
      tickBusy = false
      post({
        type: 'init',
        sats: sats.map(({ noradId, tle1, tle2 }) => ({ noradId, tle1, tle2 })),
      })
    }

    const tickTimer = setInterval(() => {
      // Hidden tab: nothing is drawn (rAF is paused), so whole-catalog
      // propagation would only drain the battery. onVisibilityChange resyncs.
      if (document.hidden || !workerReady || tickBusy) return
      const { rate } = simClock.get()
      if (performance.now() - lastTickWall < tickIntervalMs(rate)) return
      requestTick()
    }, 100)

    // --- store subscriptions (transient; no React re-renders involved) ---
    // Also the rebuild path: the long-lived worker still holds the working
    // set, but this epoch's fresh ConstellationLayer only learns the ids and
    // classes from a `ready`, so re-init it (ready → setCatalog → tick).
    const initialSats = useCatalog.getState().sats
    if (initialSats.length > 0) sendCatalog(initialSats)
    if (useCatalog.getState().selectedId !== null) applySelection(useCatalog.getState().selectedId)

    const unsubCatalog = useCatalog.subscribe((state, prev) => {
      if (state.sats !== prev.sats) sendCatalog(state.sats)
      if (state.selectedId !== prev.selectedId) applySelection(state.selectedId)
    })

    // Scrub/NOW jumps: drop the interpolation pair and force a fresh tick.
    const unsubClock = simClock.subscribe((state, prev) => {
      if (state.jumpNonce !== prev.jumpNonce) {
        constellation.onTimeJump()
        lastTickWall = 0
      }
    })

    // --- keyboard: camera movement + shortcuts ---
    const isTypingTarget = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    const stepRate = (direction: 1 | -1) => {
      const clock = simClock.get()
      const index = SIM_RATES.indexOf(clock.rate as (typeof SIM_RATES)[number])
      const next = SIM_RATES[Math.max(0, Math.min(SIM_RATES.length - 1, index + direction))]
      if (next !== undefined) clock.setRate(next)
    }

    // Transport controls travel with the ORBITAL layer (the bar itself is
    // unmounted then) and with the HUD (hidden: the bar is faded out and
    // inert) — the keyboard equivalents must go quiet with it, or an
    // invisible warp would silently suspend the live feeds.
    const timeControlsActive = () =>
      useMode.getState().satellitesVisible && !useHud.getState().hidden

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (CameraRig.isMovementKey(e.code)) {
        rig.press(e.code)
        e.preventDefault()
        return
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.code) {
        case 'KeyF':
          if (hasSelectionInMode()) useFollow.getState().toggle()
          break
        case 'Escape':
          // Innermost first, one layer per press: overlays, then an open
          // compact sheet (closing it does nothing else), then the follow
          // lock, then the selection.
          if (useMode.getState().helpOpen) useMode.getState().closeHelp()
          else if (useMode.getState().settingsOpen) useMode.getState().closeSettings()
          else if (useSheet.getState().sheet !== null) useSheet.getState().close()
          else if (useFollow.getState().following) useFollow.getState().setFollowing(false)
          else deselectInMode()
          break
        case 'Digit1':
          useMode.getState().toggleDomain('orbital')
          break
        case 'Digit2':
          useMode.getState().toggleDomain('maritime')
          break
        case 'Digit3':
          useMode.getState().toggleDomain('airspace')
          break
        case 'Space':
          if (timeControlsActive()) {
            simClock.get().togglePlay()
            e.preventDefault()
          }
          break
        case 'KeyN':
          if (timeControlsActive()) simClock.get().resetToNow()
          break
        case 'Comma':
          if (timeControlsActive()) stepRate(-1)
          break
        case 'Period':
          if (timeControlsActive()) stepRate(1)
          break
        case 'KeyH':
          useMode.getState().toggleHelp()
          break
        default:
          if (e.key === '?') useMode.getState().toggleHelp()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (CameraRig.isMovementKey(e.code)) rig.release(e.code)
    }
    const onWindowBlur = () => rig.releaseAll()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    // --- picking: ONE drill pick per tap, every hit offered to each layer ---
    const canvas = viewer.scene.canvas
    // The pointer that pressed last sizes the pick window (finger vs mouse —
    // a touch laptop has both); the media query covers a missing type.
    let lastPointerType = ''
    const onPointerDown = (e: PointerEvent) => {
      lastPointerType = e.pointerType
    }
    canvas.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    const coarsePointer = window.matchMedia('(pointer: coarse)')

    // Matchers: a hit on the selected object's own marker (tracked-satellite
    // billboard/label, ship/aircraft decal) counts as that object, so tapping
    // it keeps the selection instead of jumping to a neighbour.
    const satIdOf = (hit: unknown) =>
      tracking.ownsMarker(hit) ? useCatalog.getState().selectedId : constellation.idOf(hit)
    const shipIdOf = (hit: unknown) =>
      shipDecal.owns(hit) ? useShips.getState().selectedMmsi : shipsLayer.idOf(hit)
    const aircraftIdOf = (hit: unknown) =>
      aircraftDecal.owns(hit) ? useAircraft.getState().selectedIcao : aircraftLayer.idOf(hit)

    // Each walks the hits nearest-first and takes its layer's first claim.
    const trySat = (hits: readonly unknown[]) => {
      for (const hit of hits) {
        const id = satIdOf(hit)
        if (id === null) continue
        useMode.getState().setMode('orbital')
        useCatalog.getState().select(id)
        return true
      }
      return false
    }
    const tryShip = (hits: readonly unknown[]) => {
      for (const hit of hits) {
        const mmsi = shipIdOf(hit)
        if (mmsi === null) continue
        useMode.getState().setMode('maritime')
        useShips.getState().select(mmsi)
        return true
      }
      return false
    }
    const tryAircraft = (hits: readonly unknown[]) => {
      for (const hit of hits) {
        const icao = aircraftIdOf(hit)
        if (icao === null) continue
        useMode.getState().setMode('airspace')
        useAircraft.getState().select(icao)
        return true
      }
      return false
    }

    // Context-loss state (driven by the recovery section below). While the
    // context is gone or a rebuild is pending, a pick reads a dead buffer
    // and finds nothing — an "empty tap" that would drop the very selection
    // the rebuild is meant to keep.
    let contextLost = false
    let recoveryRequested = false

    const pickHandler = new ScreenSpaceEventHandler(canvas)
    pickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const scene = viewer.scene
      if (scene.isDestroyed() || contextLost || recoveryRequested) return
      // Pick rectangle is in drawing-buffer px (Picking.js, cesium 1.138):
      // convert the CSS window with the ratio Cesium itself applies to the
      // tap position (includes the resolutionScale cap).
      const size = pickWindowPx(
        pickWindowCssPx(lastPointerType, coarsePointer.matches),
        drawingBufferRatio(scene.drawingBufferWidth, canvas.clientWidth),
      )
      // drillPick collects up to PICK_LIMIT distinct objects in one pass,
      // nearest the tap first (PickFramebuffer spiral). Only when it found
      // fewer does it run another pass to look behind them, so an empty
      // tap costs exactly one pass (was three scene.pick calls).
      const hits: readonly unknown[] = scene.drillPick(movement.position, PICK_LIMIT, size, size)

      // Current mode's layer first; a cross-domain hit switches mode. The
      // selected object's own marker/decal is claimed by the matchers above.
      const mode = useMode.getState().mode
      const order =
        mode === 'maritime'
          ? [tryShip, tryAircraft, trySat]
          : mode === 'airspace'
            ? [tryAircraft, tryShip, trySat]
            : [trySat, tryShip, tryAircraft]
      // Near-miss = a thin line of the selection an empty tap would drop
      // (ORBITAL: the tracked orbit ring / ground track) — keep it. Anything
      // else nobody claims (footprint fill, ports, launch sites, another
      // domain's lines) is an empty tap, as is no hit at all.
      const isNearMiss = (hit: unknown) => mode === 'orbital' && tracking.ownsThinDecoration(hit)
      if (resolveTap(hits, order, isNearMiss) === 'empty') deselectInMode(mode)
    }, ScreenSpaceEventType.LEFT_CLICK)

    // --- WebGL context loss: rebuild the engine on a fresh canvas ---
    // @cesium/engine 1.138 has no webglcontextlost/restored handling at all,
    // and its GPU resources cannot be re-created in place. Recovery bumps
    // engineEpoch: this effect's cleanup destroys everything, then the
    // effect runs again on the same container. (contextLost /
    // recoveryRequested are declared above, with the pick handler.)
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined
    const recover = (reason: string) => {
      if (recoveryRequested) return
      recoveryRequested = true
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer)
      if (takeRecoverySlot(recoveryLogRef, performance.now())) {
        resumeFollowRef.current = useFollow.getState().following
      } else {
        // Rebuilding keeps failing: show the error panel (the epoch bump
        // still runs the cleanup, so nothing is left running behind it).
        setEngineError({ kind: 'lost', message: reason })
      }
      setEngineEpoch((n) => n + 1)
    }
    // Wait for webglcontextrestored, or rebuild after a grace period. Never
    // while hidden: a backgrounded tab may not get a GPU context at all.
    const scheduleRecovery = () => {
      if (recoveryRequested || recoveryTimer !== undefined || document.hidden) return
      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined
        // Went hidden during the grace period: onVisibilityChange reschedules.
        if (!document.hidden) recover('WebGL context lost')
      }, CONTEXT_RESTORE_GRACE_MS)
    }
    const isContextLost = () => {
      // getContext() hands back the canvas's existing context (Cesium asks
      // for webgl2 first, webgl as the fallback).
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
      return gl === null || gl.isContextLost()
    }
    const onContextLost = (e: Event) => {
      // Without preventDefault the browser never fires webglcontextrestored.
      e.preventDefault()
      contextLost = true
      scheduleRecovery()
    }
    const onContextRestored = () => {
      // Same rule as scheduleRecovery: never rebuild while hidden. The
      // context is still gone for this engine (its GPU resources died with
      // it), so stay marked lost; onVisibilityChange reschedules on return.
      contextLost = true
      if (document.hidden) return
      recover('WebGL context lost')
    }
    // CesiumWidget's own renderError listener has already stopped its
    // render loop; showRenderLoopErrors is off, so this is the only report.
    const onRenderError = (_scene: unknown, error: unknown) => {
      if (contextLost || isContextLost()) {
        contextLost = true
        scheduleRecovery()
        return
      }
      console.error('[cesium] render error', error)
      recover(error instanceof Error ? error.message : String(error))
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    const removeRenderErrorListener = viewer.scene.renderError.addEventListener(onRenderError)

    // --- page visibility: ticks pause while hidden, resync on return ---
    const onVisibilityChange = () => {
      if (document.hidden) return
      // The sample pair is stale after skipped ticks: same path as a
      // scrub/NOW jump — drop it and force a fresh tick.
      constellation.onTimeJump()
      lastTickWall = 0
      if (contextLost) scheduleRecovery()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    // --- render loop: sim clock, viewer clock, selected satellite ---
    let rafId = 0
    // Continue from the previous engine's last frame after a rebuild, so the
    // gap is advanced like any tab suspension (not silently dropped).
    let lastFrame = lastFrameRef.current > 0 ? lastFrameRef.current : performance.now()
    let lastTelemetry = 0
    let lastCameraSave = 0
    let lastDpr = window.devicePixelRatio || 1

    const frame = (now: number) => {
      // Clamp tab-suspend jumps only while warping (a 30 s gap at ×3600
      // would leap 30 h). At ×1 the full wall delta is exact — dropping it
      // would let a playing clock drift behind real time across tab
      // suspensions and wrongly suspend the live feeds.
      const rawDt = now - lastFrame
      const dt = simClock.get().rate === 1 ? rawDt : Math.min(rawDt, 500)
      lastFrame = now
      lastFrameRef.current = now
      // Browser zoom / monitor move changes the DPR: keep the 2× render cap.
      const dpr = window.devicePixelRatio || 1
      if (dpr !== lastDpr) {
        lastDpr = dpr
        applyRenderDensity(viewer, dpr)
      }
      simClock.get().advance(dt)
      const epochMs = simClock.get().epochMs
      syncViewerClock(viewer, epochMs)
      // Liveness edge detection: a boolean compare per frame, layer
      // visibility re-applied only when it flips (warp engaged / back to
      // NOW). Per-frame (not event-driven) because a paused or suspended-
      // tab clock drifts past the epsilon without any store event.
      const liveNow = isSimLive(simClock.get())
      if (liveNow !== clockLive) {
        clockLive = liveNow
        applyLiveVisibility()
      }
      constellation.advance(epochMs)
      // Live domains dead-reckon on wall time (they can't time-travel);
      // both layers self-gate to one update per ~250 ms.
      shipsLayer.advance(Date.now())
      aircraftLayer.advance(Date.now())

      if (selectedSatrec) {
        // Re-sample the orbit ring when sim time leaves the sampled window;
        // the ground track below slides in real time.
        if (trackNeedsRefresh(epochMs)) {
          refreshTrack(epochMs)
        }
        if (groundWindow) tracking.setGroundTrack(groundWindow.update(epochMs))
        const live = propagateEcef(selectedSatrec, epochMs)
        if (live) {
          followSatPos.x = live.positionEcefM[0]
          followSatPos.y = live.positionEcefM[1]
          followSatPos.z = live.positionEcefM[2]
          followSatValid = true
          lastAltKm = live.altKm
          tracking.updateLive({
            positionEcefM: live.positionEcefM,
            footprintRadiusM: footprintRadiusM(live.altKm),
            name: selectedName,
            gmstRad: gmstAt(epochMs),
          })
          if (now - lastTelemetry > TELEMETRY_INTERVAL_MS) {
            lastTelemetry = now
            useTelemetry.getState().update({
              altKm: live.altKm,
              velocityKmS: live.velocityKmS,
              latDeg: live.latDeg,
              lonDeg: live.lonDeg,
            })
          }
        }
      }
      // Selected ship/aircraft world decals: dead-reckoned to wall-now,
      // world-oriented (ship bow along true heading with COG fallback,
      // aircraft nose along track), screen-proportional size.
      // Skipped entirely while the clock is not live — applyLiveVisibility
      // hid them, and setPose re-shows them on the first live frame.
      if (clockLive) {
        const selMmsi = useShips.getState().selectedMmsi
        if (selMmsi !== null) {
          const ship = useShips.getState().byMmsi.get(selMmsi)
          if (ship) {
            const dtS = Math.min((Date.now() - ship.tsMs) / 1000, 1800)
            const v = ship.sogKn >= 0.2 ? ship.sogKn * 0.514444 : 0
            // True heading (bow) first; COG as the fallback — the decal
            // always needs some bearing, even for a headingless moored ship.
            const bearingDeg = ship.hdgDeg ?? ship.cogDeg
            const brg = bearingDeg * DEG
            const lat = ship.latDeg + (v * Math.cos(brg) * dtS) / 111_320
            const lon =
              ship.lonDeg +
              (v * Math.sin(brg) * dtS) / (111_320 * Math.max(0.01, Math.cos(ship.latDeg * DEG)))
            shipDecal.setPose(lon, lat, 50, bearingDeg, viewer.camera.positionWC)
          }
        }
        const selIcao = useAircraft.getState().selectedIcao
        if (selIcao !== null) {
          const a = useAircraft.getState().byIcao.get(selIcao)
          if (a) {
            const dtS = Math.min((Date.now() - a.tsMs) / 1000, 900)
            const v = a.velocityMs ?? 0
            const brg = (a.trackDeg ?? 0) * DEG
            const lat = a.latDeg + (v * Math.cos(brg) * dtS) / 111_320
            const lon =
              a.lonDeg +
              (v * Math.sin(brg) * dtS) / (111_320 * Math.max(0.01, Math.cos(a.latDeg * DEG)))
            const alt = Math.max(50, (a.altM ?? 0) + (a.verticalRateMs ?? 0) * dtS)
            aircraftDecal.setPose(lon, lat, alt, a.trackDeg ?? 0, viewer.camera.positionWC)
          }
        }
      }
      rig.update(dt)
      // Persist the free camera every few seconds so the next session
      // reopens at the same spot (skipped while follow-locked: the camera
      // lives in a moving target-local frame there).
      if (now - lastCameraSave > 5000 && !rig.isFollowing()) {
        lastCameraSave = now
        const cam = viewer.camera
        usePrefs.getState().saveCamera({
          x: cam.positionWC.x,
          y: cam.positionWC.y,
          z: cam.positionWC.z,
          headingRad: cam.heading,
          pitchRad: cam.pitch,
          rollRad: cam.roll,
        })
      }
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    // Rebuilt after a context loss: re-engage the follow lock it interrupted.
    if (resumeFollowRef.current) {
      resumeFollowRef.current = false
      if (hasSelectionInMode()) useFollow.getState().setFollowing(true)
    }

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(tickTimer)
      if (recoveryTimer !== undefined) clearTimeout(recoveryTimer)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true })
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      removeRenderErrorListener()
      useFollow.getState().setFollowing(false)
      rig.dispose()
      unsubCatalog()
      unsubClock()
      unsubShips()
      unsubAircraft()
      unsubMode()
      unsubFollow()
      unsubPrefs()
      pickHandler.destroy()
      // The worker itself lives on (terminated by its own effect on unmount).
      worker.removeEventListener('message', onWorkerMessage)
      constellation.dispose()
      tracking.dispose()
      shipDecal.dispose()
      aircraftDecal.dispose()
      shipsLayer.dispose()
      aircraftLayer.dispose()
      launchSitesLayer.dispose()
      portsLayer.dispose()
      if (import.meta.env.DEV) {
        const w = window as unknown as { __opsViewer?: unknown }
        if (w.__opsViewer === viewer) delete w.__opsViewer
      }
      // Also removes the .cesium-credits div createOrbitalViewer appended.
      destroyOrbitalViewer(viewer)
    }
  }, [engineEpoch])

  if (engineError) {
    return (
      <div className="engine-error">
        <div className="engine-error-panel">
          {engineError.kind === 'lost' ? (
            <>
              <h1>RENDERER LOST</h1>
              <p>The WebGL renderer was lost and could not be restored: {engineError.message}</p>
              <p>Reload the page to restart it.</p>
            </>
          ) : (
            <>
              <h1>RENDERER OFFLINE</h1>
              <p>Cesium failed to initialize: {engineError.message}</p>
              <p>Try a browser with WebGL 2 support.</p>
            </>
          )}
        </div>
      </div>
    )
  }
  return <div ref={containerRef} className="globe-root" />
}
