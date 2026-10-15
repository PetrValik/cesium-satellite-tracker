import type { Viewer } from 'cesium'
import type { CameraRig } from '../../core/engine/CameraRig'
import { applyRenderDensity, syncViewerClock } from '../../core/engine/createViewer'
import { simClock } from '../../core/sim/simClock'
import { usePrefs } from '../../core/ui/prefsStore'
import type { AircraftLayer } from '../../features/airspace/AircraftLayer'
import type { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import type { ShipsLayer } from '../../features/maritime/ShipsLayer'
import type { SelectedSatellite } from '../../features/tracking/SelectedSatellite'
import type { GlobeFollow } from './follow'
import type { LayerSync } from './layerSync'

/** While warping, one frame advances at most this much wall time. */
const MAX_WARP_FRAME_MS = 500
/** How often the free camera is persisted for the next session. */
const CAMERA_SAVE_INTERVAL_MS = 5000

/**
 * Wall ms one frame advances the sim clock by. Tab-suspend jumps are
 * clamped only while warping (a 30 s gap at ×3600 would leap 30 h). At ×1
 * the full wall delta is exact — dropping it would let a playing clock
 * drift behind real time across tab suspensions and wrongly suspend the
 * live feeds.
 */
export function frameAdvanceMs(rawDtMs: number, rate: number): number {
  return rate === 1 ? rawDtMs : Math.min(rawDtMs, MAX_WARP_FRAME_MS)
}

/** Timing one globe hands the next across a rebuild. */
export interface FrameCarry {
  /** Last rAF timestamp (0: none yet), so sim time loses no wall time across a rebuild. */
  lastFrameMs: number
}

interface FrameParts {
  viewer: Viewer
  constellation: ConstellationLayer
  ships: ShipsLayer
  aircraft: AircraftLayer
  satellite: SelectedSatellite
  follow: GlobeFollow
  layerSync: LayerSync
  rig: CameraRig
  carry: FrameCarry
}

/**
 * The render loop: sim clock → viewer clock, the constellation between
 * worker snapshots and the selected satellite on SIM time; ships and
 * aircraft dead-reckoned on WALL time (they never time-travel with the
 * sim). Allocates nothing per frame. Returns the stop.
 */
export function startFrameLoop(p: FrameParts): () => void {
  const { viewer, constellation, ships, aircraft, satellite, follow, layerSync, rig, carry } = p
  let rafId = 0
  // Continue from the previous globe's last frame after a rebuild, so the
  // gap is advanced like any tab suspension (not silently dropped).
  let lastFrame = carry.lastFrameMs > 0 ? carry.lastFrameMs : performance.now()
  let lastCameraSave = 0
  let lastDpr = window.devicePixelRatio || 1

  const frame = (now: number) => {
    const dt = frameAdvanceMs(now - lastFrame, simClock.get().rate)
    lastFrame = now
    carry.lastFrameMs = now
    // Browser zoom / monitor move changes the DPR: keep the 2× render cap.
    const dpr = window.devicePixelRatio || 1
    if (dpr !== lastDpr) {
      lastDpr = dpr
      applyRenderDensity(viewer, dpr)
    }
    simClock.get().advance(dt)
    const epochMs = simClock.get().epochMs
    syncViewerClock(viewer, epochMs)
    const clockLive = layerSync.updateLiveness()
    constellation.advance(epochMs)
    // Live domains dead-reckon on wall time (they can't time-travel);
    // both layers self-gate to one update per ~250 ms.
    const wallNowMs = Date.now()
    ships.advance(wallNowMs)
    aircraft.advance(wallNowMs)
    const live = satellite.frame(epochMs, now)
    if (live) follow.holdSatellite(live)
    // Skipped entirely while the clock is not live — the live gate hid the
    // decals, and the first live frame's pose re-shows them.
    if (clockLive) follow.poseDecals(wallNowMs, viewer.camera.positionWC)
    rig.update(dt)
    // Persist the free camera every few seconds so the next session
    // reopens at the same spot (skipped while follow-locked: the camera
    // lives in a moving target-local frame there).
    if (now - lastCameraSave > CAMERA_SAVE_INTERVAL_MS && !rig.isFollowing()) {
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
  return () => cancelAnimationFrame(rafId)
}
