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
import {
  Cartesian3,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Cartesian2,
  type Viewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { SatRec } from 'satellite.js'
import { SHIP_TYPES, type Aircraft, type Ship } from '@orbital-ops/shared'
import { CameraRig } from '../core/engine/CameraRig'
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
import { aircraftIcon, shipIcon } from '../core/engine/icons'
import { SIGNAL_AMBER } from '../core/engine/signalColors'
import { WorldDecal } from '../core/engine/WorldDecal'
import { isSimLive, simClock, SIM_RATES } from '../core/sim/simClock'
import { useFollow } from '../core/ui/followStore'
import { useHud } from '../core/ui/hudStore'
import { useMode, type OpsMode } from '../core/ui/modeStore'
import { usePrefs } from '../core/ui/prefsStore'
import { useSheet } from '../core/ui/sheetStore'
import { AircraftLayer } from '../features/airspace/AircraftLayer'
import { categoryOf } from '../features/airspace/aircraftCategory'
import { aircraftPositionAt, type AircraftPosition } from '../features/airspace/aircraftMotion'
import { ALT_BANDS, bandOf, useAircraft, type AircraftState } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { ConstellationLayer } from '../features/constellation/ConstellationLayer'
import { LaunchSitesLayer } from '../features/infra/LaunchSitesLayer'
import { PortsLayer } from '../features/infra/PortsLayer'
import { ShipsLayer } from '../features/maritime/ShipsLayer'
import { shipBearingDeg, shipPositionAt, type ShipPosition } from '../features/maritime/shipMotion'
import { useShips, type ShipsState } from '../features/maritime/shipsStore'
import { GroundTrackWindow } from '../features/tracking/GroundTrackWindow'
import { useTelemetry } from '../features/tracking/telemetryStore'
import { TrackingVisuals } from '../features/tracking/TrackingVisuals'
import { AIRCRAFT_CATEGORIES } from '../lib/aircraftCategories'
import {
  classifyOrbit,
  createSatrec,
  createSatStateEcef,
  orbitalPeriodMinutes,
  propagateEcef,
  sampleOrbitRingEci,
  type SatStateEcef,
} from '../lib/orbital'
import type { SatInit, WorkerRequest, WorkerResponse } from '../lib/protocol'
import launchSites from '../data/launchSites.json'
import ports from '../data/ports.json'
import { deselectInMode, hasSelectionInMode, resolveTap } from './selectionMode'

/** Wall-clock ms between constellation ticks; tighter under heavy time warp. */
function tickIntervalMs(rate: number): number {
  return Math.abs(rate) > 60 ? 250 : 1000
}

const TELEMETRY_INTERVAL_MS = 200

/**
 * Lowest altitude the selected ship/aircraft decal is drawn at — a height-0
 * quad z-fights the globe (depthTestAgainstTerrain). The follow camera
 * targets the very same point, so camera and decal never disagree.
 */
const DECAL_MIN_ALT_M = 50
/** The orbital follow range is sized from this until a satellite's altitude is known. */
const DEFAULT_FOLLOW_ALT_KM = 400

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

    /**
     * A build that threw — the viewer, or anything built on it — ends here
     * with nothing of it left alive: a first build shows the error panel; a
     * rebuild after context loss retries on a fresh epoch, within the
     * recovery budget. Returns the effect cleanup for a pending retry.
     */
    const failBuild = (err: unknown): (() => void) | undefined => {
      const message = err instanceof Error ? err.message : String(err)
      if (engineEpoch === 0 || !takeRecoverySlot(recoveryLogRef, performance.now())) {
        // Init failure is only observable from inside this effect.
        setEngineError({ kind: engineEpoch === 0 ? 'init' : 'lost', message })
        return undefined
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

    let viewer: Viewer
    try {
      // A throwing factory has already removed the divs it and Viewer.js added.
      viewer = createOrbitalViewer(container, usePrefs.getState().basemap)
    } catch (err) {
      return failBuild(err)
    }

    // Every Cesium object of this epoch is built inside one try: a throw part
    // way (a 2D canvas or GPU allocation failing — most likely during a
    // context-loss rebuild) disposes what was already built, newest first,
    // then the viewer (which takes anything half-built with it), and goes
    // down the same path as a viewer that never came up.
    const built: { dispose(): void }[] = []
    const own = <T extends { dispose(): void }>(resource: T): T => {
      built.push(resource)
      return resource
    }
    let constellation: ConstellationLayer
    let tracking: TrackingVisuals
    let rig: CameraRig
    let shipsLayer: ShipsLayer
    let aircraftLayer: AircraftLayer
    let shipDecal: WorldDecal
    let aircraftDecal: WorldDecal
    let launchSitesLayer: LaunchSitesLayer
    let portsLayer: PortsLayer
    let pickHandler: ScreenSpaceEventHandler
    try {
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
      constellation = own(new ConstellationLayer(viewer.scene))
      tracking = own(new TrackingVisuals(viewer))
      rig = own(new CameraRig(viewer))
      shipsLayer = own(new ShipsLayer(viewer.scene))
      aircraftLayer = own(new AircraftLayer(viewer.scene))
      // World-oriented flat markers for the selected ship/aircraft: the
      // camera-facing layer billboard is hidden while selected and this decal
      // (lying in the map plane, nose along the course) represents it instead.
      shipDecal = own(new WorldDecal(viewer.scene, shipIcon(), SIGNAL_AMBER))
      aircraftDecal = own(new WorldDecal(viewer.scene, aircraftIcon(), SIGNAL_AMBER))
      launchSitesLayer = own(new LaunchSitesLayer(viewer.scene, launchSites))
      portsLayer = own(new PortsLayer(viewer.scene, ports))
      // Last: it has destroy(), not dispose(), and nothing follows it here.
      pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    } catch (err) {
      for (let i = built.length - 1; i >= 0; i--) built[i].dispose()
      destroyOrbitalViewer(viewer)
      return failBuild(err)
    }

    // Dev-only escape hatch for live debugging in the browser console.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __opsViewer?: unknown }).__opsViewer = viewer
    }

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

    // A rebuild (or HMR) mounts with a selection already in the stores; the
    // subscriptions below only see changes, so apply it once here — before
    // applyPalettes() first feeds the layers, which then hide it.
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

    // --- user palettes (persisted prefs); also the layers' first feed ---
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
          // Selecting a vessel locks the camera onto it (the ask: click → fly
          // & ride). A fresh lock engages through the follow subscription; an
          // existing one is re-pointed here — never both (one fly-in, not two).
          if (useFollow.getState().following) engageFollow()
          else useFollow.getState().setFollowing(true)
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
          if (useFollow.getState().following) engageFollow()
          else useFollow.getState().setFollowing(true)
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

    // Reused propagation state for the selected satellite (per frame).
    const liveState = createSatStateEcef()

    // --- camera follow-lock targets ---
    const followSatPos = new Cartesian3()
    let followSatValid = false
    let lastAltKm = DEFAULT_FOLLOW_ALT_KM
    const liveTargetScratch = new Cartesian3()
    const shipPos: ShipPosition = { latDeg: 0, lonDeg: 0 }
    const aircraftPos: AircraftPosition = { latDeg: 0, lonDeg: 0, altM: 0 }

    /** Hold a propagated state as the orbital follow target and range basis. */
    const holdFollowSat = (state: SatStateEcef) => {
      followSatPos.x = state.positionEcefM[0]
      followSatPos.y = state.positionEcefM[1]
      followSatPos.z = state.positionEcefM[2]
      followSatValid = true
      lastAltKm = state.altKm
    }

    /**
     * The selected ship dead-reckoned to `wallNowMs` into `shipPos` — the
     * slice's own motion rule, the one its layer uses — or undefined when
     * none is selected. Decal and follow camera both pose from this.
     */
    const poseSelectedShip = (wallNowMs: number): Ship | undefined => {
      const st = useShips.getState()
      const ship = st.selectedMmsi === null ? undefined : st.byMmsi.get(st.selectedMmsi)
      if (ship) shipPositionAt(ship, wallNowMs, shipPos)
      return ship
    }

    /** Same for the selected aircraft into `aircraftPos`, lifted to DECAL_MIN_ALT_M. */
    const poseSelectedAircraft = (wallNowMs: number): Aircraft | undefined => {
      const st = useAircraft.getState()
      const a = st.selectedIcao === null ? undefined : st.byIcao.get(st.selectedIcao)
      if (a) {
        aircraftPositionAt(a, wallNowMs, aircraftPos)
        aircraftPos.altM = Math.max(DECAL_MIN_ALT_M, aircraftPos.altM)
      }
      return a
    }

    /** Follow target: exactly the point the selected ship's decal occupies. */
    const shipTarget = (): Cartesian3 | null =>
      poseSelectedShip(Date.now()) === undefined
        ? null
        : Cartesian3.fromDegrees(
            shipPos.lonDeg,
            shipPos.latDeg,
            DECAL_MIN_ALT_M,
            undefined,
            liveTargetScratch,
          )

    /** Follow target: exactly the point the selected aircraft's decal occupies. */
    const aircraftTarget = (): Cartesian3 | null =>
      poseSelectedAircraft(Date.now()) === undefined
        ? null
        : Cartesian3.fromDegrees(
            aircraftPos.lonDeg,
            aircraftPos.latDeg,
            aircraftPos.altM,
            undefined,
            liveTargetScratch,
          )

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
      lastAltKm = DEFAULT_FOLLOW_ALT_KM
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
      const epochMs = simClock.get().epochMs
      refreshTrack(epochMs)
      // Seed the follow target now: engageFollow below (and a resumed lock
      // after a rebuild) runs before the next frame would, and must size the
      // range for THIS satellite, not the previous one.
      const seed = propagateEcef(satrec, epochMs, liveState)
      if (seed) holdFollowSat(seed)
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

    const sendCatalog = (sats: readonly SatInit[]) => {
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

    // A claimer walks the hits nearest-first and takes its layer's first
    // claim: it focuses that layer's mode and selects the object there.
    const claimer =
      <Id,>(idOf: (hit: unknown) => Id | null, mode: OpsMode, select: (id: Id) => void) =>
      (hits: readonly unknown[]): boolean => {
        for (const hit of hits) {
          const id = idOf(hit)
          if (id === null) continue
          useMode.getState().setMode(mode)
          select(id)
          return true
        }
        return false
      }
    const trySat = claimer(satIdOf, 'orbital', (id) => useCatalog.getState().select(id))
    const tryShip = claimer(shipIdOf, 'maritime', (mmsi) => useShips.getState().select(mmsi))
    const tryAircraft = claimer(aircraftIdOf, 'airspace', (icao) =>
      useAircraft.getState().select(icao),
    )

    // Context-loss state (driven by the recovery section below). While the
    // context is gone or a rebuild is pending, a pick reads a dead buffer
    // and finds nothing — an "empty tap" that would drop the very selection
    // the rebuild is meant to keep.
    let contextLost = false
    let recoveryRequested = false

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
      const wallNowMs = Date.now()
      shipsLayer.advance(wallNowMs)
      aircraftLayer.advance(wallNowMs)

      if (selectedSatrec) {
        // Re-sample the orbit ring when sim time leaves the sampled window;
        // the ground track below slides in real time.
        if (trackNeedsRefresh(epochMs)) {
          refreshTrack(epochMs)
        }
        if (groundWindow) tracking.setGroundTrack(groundWindow.update(epochMs))
        const live = propagateEcef(selectedSatrec, epochMs, liveState)
        if (live) {
          holdFollowSat(live)
          tracking.updateLive(live, selectedName)
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
      // Selected ship/aircraft world decals: at the same dead-reckoned point
      // the follow camera targets (poseSelected*), world-oriented — ship bow
      // along shipBearingDeg, falling back to COG because the decal always
      // needs some bearing, even for a headingless moored ship; aircraft
      // nose along track, north when none — screen-proportional size.
      // Skipped entirely while the clock is not live — applyLiveVisibility
      // hid them, and setPose re-shows them on the first live frame.
      if (clockLive) {
        const ship = poseSelectedShip(wallNowMs)
        if (ship) {
          shipDecal.setPose(
            shipPos.lonDeg,
            shipPos.latDeg,
            DECAL_MIN_ALT_M,
            shipBearingDeg(ship) ?? ship.cogDeg,
            viewer.camera.positionWC,
          )
        }
        const aircraft = poseSelectedAircraft(wallNowMs)
        if (aircraft) {
          aircraftDecal.setPose(
            aircraftPos.lonDeg,
            aircraftPos.latDeg,
            aircraftPos.altM,
            aircraft.trackDeg ?? 0,
            viewer.camera.positionWC,
          )
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
