import { useEffect, useRef, useState } from 'react'
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Cartesian2 } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { createOrbitalViewer, syncViewerClock } from '../core/engine/createViewer'
import { simClock } from '../core/sim/simClock'
import { ConstellationLayer } from '../features/constellation/ConstellationLayer'
import { GroundTrackWindow } from '../features/tracking/GroundTrackWindow'
import { TrackingVisuals } from '../features/tracking/TrackingVisuals'
import { AircraftLayer } from '../features/airspace/AircraftLayer'
import { useAircraft } from '../features/airspace/aircraftStore'
import { LaunchSitesLayer } from '../features/infra/LaunchSitesLayer'
import { PortsLayer } from '../features/infra/PortsLayer'
import { ShipsLayer } from '../features/maritime/ShipsLayer'
import { useShips } from '../features/maritime/shipsStore'
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

/** Wall-clock ms between constellation ticks; tighter under heavy time warp. */
function tickIntervalMs(rate: number): number {
  return Math.abs(rate) > 60 ? 250 : 1000
}

const TELEMETRY_INTERVAL_MS = 200

export function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [engineError, setEngineError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let viewer
    try {
      viewer = createOrbitalViewer(container)
    } catch (err) {
      // Init failure is only observable from inside this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEngineError(err instanceof Error ? err.message : String(err))
      return
    }

    const constellation = new ConstellationLayer(viewer.scene)
    const tracking = new TrackingVisuals(viewer)
    const shipsLayer = new ShipsLayer(viewer.scene)
    const aircraftLayer = new AircraftLayer(viewer.scene)
    const launchSitesLayer = new LaunchSitesLayer(viewer.scene, launchSites)
    const portsLayer = new PortsLayer(viewer.scene, ports)
    const worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
      type: 'module',
    })
    const post = (msg: WorkerRequest) => worker.postMessage(msg)

    // --- live domain layers: data + infra visibility ---
    shipsLayer.setShips(useShips.getState().ships)
    aircraftLayer.setAircraft(useAircraft.getState().aircraft)
    launchSitesLayer.setVisible(useMode.getState().launchSites)
    portsLayer.setVisible(useMode.getState().ports)

    const unsubShips = useShips.subscribe((state, prev) => {
      if (state.ships !== prev.ships) shipsLayer.setShips(state.ships)
    })
    const unsubAircraft = useAircraft.subscribe((state, prev) => {
      if (state.aircraft !== prev.aircraft) aircraftLayer.setAircraft(state.aircraft)
    })
    const unsubMode = useMode.subscribe((state, prev) => {
      if (state.launchSites !== prev.launchSites) launchSitesLayer.setVisible(state.launchSites)
      if (state.ports !== prev.ports) portsLayer.setVisible(state.ports)
    })

    // --- selected satellite (propagated on the main thread every frame) ---
    let selectedSatrec: SatRec | null = null
    let selectedName = ''
    let groundWindow: GroundTrackWindow | null = null
    let trackAnchorMs = 0
    let trackPeriodMs = 0

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
      groundWindow = null
      tracking.clear()
      useTelemetry.getState().clear()
      if (noradId === null) return
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

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
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

    const sendCatalog = (sats: { noradId: number; tle1: string; tle2: string }[]) => {
      workerReady = false
      tickBusy = false
      post({
        type: 'init',
        sats: sats.map(({ noradId, tle1, tle2 }) => ({ noradId, tle1, tle2 })),
      })
    }

    const tickTimer = setInterval(() => {
      if (!workerReady || tickBusy) return
      const { rate } = simClock.get()
      if (performance.now() - lastTickWall < tickIntervalMs(rate)) return
      requestTick()
    }, 100)

    // --- store subscriptions (transient; no React re-renders involved) ---
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

    // --- picking: current mode's layer first, cross-domain hits switch mode ---
    const pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    pickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const mode = useMode.getState().mode

      const trySat = () => {
        const id = constellation.pick(movement.position, viewer.scene)
        if (id === null) return false
        useMode.getState().setMode('orbital')
        useCatalog.getState().select(id)
        return true
      }
      const tryShip = () => {
        const mmsi = shipsLayer.pick(movement.position, viewer.scene)
        if (mmsi === null) return false
        useMode.getState().setMode('maritime')
        useShips.getState().select(mmsi)
        return true
      }
      const tryAircraft = () => {
        const icao = aircraftLayer.pick(movement.position, viewer.scene)
        if (icao === null) return false
        useMode.getState().setMode('airspace')
        useAircraft.getState().select(icao)
        return true
      }

      const order =
        mode === 'maritime'
          ? [tryShip, tryAircraft, trySat]
          : mode === 'airspace'
            ? [tryAircraft, tryShip, trySat]
            : [trySat, tryShip, tryAircraft]
      if (order.some((attempt) => attempt())) return

      // Empty click: deselect within the current mode only.
      if (mode === 'orbital') useCatalog.getState().select(null)
      else if (mode === 'maritime') useShips.getState().select(null)
      else useAircraft.getState().select(null)
    }, ScreenSpaceEventType.LEFT_CLICK)

    // --- render loop: sim clock, viewer clock, selected satellite ---
    let rafId = 0
    let lastFrame = performance.now()
    let lastTelemetry = 0

    const frame = (now: number) => {
      const dt = Math.min(now - lastFrame, 500) // clamp tab-suspend jumps
      lastFrame = now
      simClock.get().advance(dt)
      const epochMs = simClock.get().epochMs
      syncViewerClock(viewer, epochMs)
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
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafId)
      clearInterval(tickTimer)
      unsubCatalog()
      unsubClock()
      unsubShips()
      unsubAircraft()
      unsubMode()
      pickHandler.destroy()
      worker.terminate()
      constellation.dispose()
      tracking.dispose()
      shipsLayer.dispose()
      aircraftLayer.dispose()
      launchSitesLayer.dispose()
      portsLayer.dispose()
      if (!viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  if (engineError) {
    return (
      <div className="engine-error">
        <div className="engine-error-panel">
          <h1>RENDERER OFFLINE</h1>
          <p>Cesium failed to initialize: {engineError}</p>
          <p>Try a browser with WebGL 2 support.</p>
        </div>
      </div>
    )
  }
  return <div ref={containerRef} className="globe-root" />
}
