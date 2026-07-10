import { useEffect, useRef, useState } from 'react'
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Cartesian2 } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { createOrbitalViewer, syncViewerClock } from '../core/engine/createViewer'
import { simClock } from '../core/sim/simClock'
import { ConstellationLayer } from '../features/constellation/ConstellationLayer'
import { TrackingVisuals } from '../features/tracking/TrackingVisuals'
import { useCatalog } from '../features/catalog/catalogStore'
import { useTelemetry } from '../features/tracking/telemetryStore'
import {
  classifyOrbit,
  createSatrec,
  footprintRadiusM,
  orbitalPeriodMinutes,
  propagateEcef,
  sampleOrbitTrack,
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
    const worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
      type: 'module',
    })
    const post = (msg: WorkerRequest) => worker.postMessage(msg)

    // --- selected satellite (propagated on the main thread every frame) ---
    let selectedSatrec: SatRec | null = null
    let selectedName = ''
    let trackEpochMs = 0
    let trackPeriodMin = 0

    const refreshTrack = (epochMs: number) => {
      if (!selectedSatrec) return
      const track = sampleOrbitTrack(selectedSatrec, epochMs)
      tracking.setTrack(track)
      trackEpochMs = epochMs
      trackPeriodMin = track.periodMinutes
    }

    const applySelection = (noradId: number | null) => {
      constellation.setSelected(noradId)
      selectedSatrec = null
      if (noradId === null) {
        tracking.clear()
        useTelemetry.getState().clear()
        return
      }
      const sat = useCatalog.getState().byId.get(noradId)
      if (!sat) return
      const satrec = createSatrec(sat.tle1, sat.tle2)
      if (!satrec) return
      selectedSatrec = satrec
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

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        constellation.setCatalog(msg.noradIds, msg.classes)
        constellation.setSelected(useCatalog.getState().selectedId)
        workerReady = true
        tickBusy = true
        post({ type: 'tick', epochMs: simClock.get().epochMs })
      } else if (msg.type === 'positions') {
        constellation.updatePositions(msg.positions)
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
      tickBusy = true
      post({ type: 'tick', epochMs: simClock.get().epochMs })
    }, 100)

    // --- store subscriptions (transient; no React re-renders involved) ---
    const initialSats = useCatalog.getState().sats
    if (initialSats.length > 0) sendCatalog(initialSats)
    if (useCatalog.getState().selectedId !== null) applySelection(useCatalog.getState().selectedId)

    const unsubCatalog = useCatalog.subscribe((state, prev) => {
      if (state.sats !== prev.sats) sendCatalog(state.sats)
      if (state.selectedId !== prev.selectedId) applySelection(state.selectedId)
    })

    // Scrub/NOW jumps: force an immediate constellation re-tick.
    const unsubClock = simClock.subscribe((state, prev) => {
      if (Math.abs(state.epochMs - prev.epochMs) > 60_000) lastTickWall = 0
    })

    // --- picking ---
    const pickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas)
    pickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = constellation.pick(movement.position, viewer.scene)
      useCatalog.getState().select(picked)
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

      if (selectedSatrec) {
        // Re-sample the orbit path when sim time leaves the sampled window.
        const windowMs = trackPeriodMin * 60_000
        if (epochMs < trackEpochMs || epochMs > trackEpochMs + windowMs * 0.6) {
          refreshTrack(epochMs)
        }
        const live = propagateEcef(selectedSatrec, epochMs)
        if (live) {
          tracking.updateLive({
            positionEcefM: live.positionEcefM,
            footprintRadiusM: footprintRadiusM(live.altKm),
            name: selectedName,
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
      pickHandler.destroy()
      worker.terminate()
      constellation.dispose()
      tracking.dispose()
      if (!viewer.isDestroyed()) viewer.destroy()
    }
  }, [])

  if (engineError) {
    return (
      <div className="engine-error">
        <h1>RENDERER OFFLINE</h1>
        <p>Cesium failed to initialize: {engineError}</p>
        <p>Try a browser with WebGL 2 support.</p>
      </div>
    )
  }
  return <div ref={containerRef} className="globe-root" />
}
