import { Cartesian3, type Viewer } from 'cesium'
import { CameraRig } from '../../core/engine/CameraRig'
import { createOrbitalViewer, destroyOrbitalViewer } from '../../core/engine/createViewer'
import { aircraftIcon, shipIcon } from '../../core/engine/icons'
import { watchRendererHealth } from '../../core/engine/rendererHealth'
import { SIGNAL_AMBER } from '../../core/engine/signalColors'
import { TapPicker } from '../../core/engine/TapPicker'
import { WorldDecal } from '../../core/engine/WorldDecal'
import { usePrefs } from '../../core/ui/prefsStore'
import { AircraftLayer } from '../../features/airspace/AircraftLayer'
import { ConstellationLayer } from '../../features/constellation/ConstellationLayer'
import { LaunchSitesLayer } from '../../features/infra/LaunchSitesLayer'
import { PortsLayer } from '../../features/infra/PortsLayer'
import { ShipsLayer } from '../../features/maritime/ShipsLayer'
import { SelectedSatellite } from '../../features/tracking/SelectedSatellite'
import { TrackingVisuals } from '../../features/tracking/TrackingVisuals'
import launchSites from '../../data/launchSites.json'
import ports from '../../data/ports.json'
import { rendererStep } from './buildFailure'
import { ConstellationFeed } from './constellationFeed'
import { GlobeFollow } from './follow'
import { startFrameLoop, type FrameCarry } from './frameLoop'
import { bindGlobeKeys } from './globeKeys'
import { LayerSync } from './layerSync'
import { createTapRouter } from './tapRouting'

/** What one globe hands the next across a context-loss rebuild. */
export interface GlobeCarry extends FrameCarry {
  /** A follow lock that was active when the renderer died, re-engaged by the next globe. */
  resumeFollow: boolean
}

interface GlobeOptions {
  /** The propagation worker. It outlives every globe; its owner terminates it. */
  worker: Worker
  /** Mutable state shared with the next globe (read at build, written while running). */
  carry: GlobeCarry
  /**
   * The renderer died (lost WebGL context, render error). Called at most
   * once per globe; the host rebuilds on a fresh container epoch or gives up.
   */
  onRendererLost: (reason: string) => void
}

export interface Globe {
  /** Tear everything down, newest first, then the viewer. Idempotent. */
  dispose(): void
}

/** Reopen where the user left off (free camera only; a follow lock overrides it). */
function restoreCamera(viewer: Viewer): void {
  const saved = usePrefs.getState().lastCamera
  if (saved === null) return
  viewer.camera.setView({
    destination: new Cartesian3(saved.x, saved.y, saved.z),
    orientation: { heading: saved.headingRad, pitch: saved.pitchRad, roll: saved.rollRad },
  })
}

/**
 * Build the whole globe in `container`: the Cesium viewer, every layer,
 * the store wiring, follow lock, worker feed, keyboard, tap picking,
 * renderer-health watch and the render loop. Non-React; GlobeView mounts it.
 *
 * Everything built registers its teardown as it is made, and ONE dispose
 * runs those newest first, then destroys the viewer. A throw part way (a
 * 2D canvas or GPU allocation failing — most likely during a context-loss
 * rebuild — or a bug in the store wiring) runs that same dispose before
 * rethrowing, so nothing of a failed build is left alive. The viewer and the
 * Cesium-backed classes (layers, rig, decals) are built inside
 * `rendererStep`, so the host can tell a renderer failure
 * (RendererBuildError) from an app bug in the wiring. Those classes' own
 * setup counts as renderer too — including the infra layers walking their
 * committed launch-site/port JSON.
 */
export function createGlobe(container: HTMLElement, options: GlobeOptions): Globe {
  const basemap = usePrefs.getState().basemap
  // A throwing factory has already removed the divs it and Viewer.js added.
  const viewer = rendererStep(() => createOrbitalViewer(container, basemap))

  const teardown: (() => void)[] = []
  const own = <T extends { dispose(): void }>(resource: T): T => {
    teardown.push(() => resource.dispose())
    return resource
  }
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (let i = teardown.length - 1; i >= 0; i--) teardown[i]()
    teardown.length = 0
    // Also removes the .cesium-credits div createOrbitalViewer appended.
    destroyOrbitalViewer(viewer)
  }

  try {
    restoreCamera(viewer)
    const scene = viewer.scene
    // The Cesium scene graph (primitives, entities, sprite canvases); each
    // registers its teardown as it is made — properties evaluate in order.
    const {
      constellation,
      tracking,
      rig,
      ships,
      aircraft,
      shipDecal,
      aircraftDecal,
      launchSitesLayer,
      portsLayer,
    } = rendererStep(() => ({
      constellation: own(new ConstellationLayer(scene)),
      tracking: own(new TrackingVisuals(viewer)),
      rig: own(new CameraRig(viewer)),
      ships: own(new ShipsLayer(scene)),
      aircraft: own(new AircraftLayer(scene)),
      // World-oriented flat markers for the selected ship/aircraft: the
      // camera-facing layer billboard is hidden while selected and this
      // decal (lying in the map plane, nose along the course) represents it.
      shipDecal: own(new WorldDecal(scene, shipIcon(), SIGNAL_AMBER)),
      aircraftDecal: own(new WorldDecal(scene, aircraftIcon(), SIGNAL_AMBER)),
      launchSitesLayer: own(new LaunchSitesLayer(scene, launchSites)),
      portsLayer: own(new PortsLayer(scene, ports)),
    }))

    // Dev-only escape hatch for live debugging in the browser console.
    if (import.meta.env.DEV) {
      const w = window as unknown as { __opsViewer?: unknown }
      w.__opsViewer = viewer
      teardown.push(() => {
        if (w.__opsViewer === viewer) delete w.__opsViewer
      })
    }

    const satellite = new SelectedSatellite(tracking)
    const follow = own(new GlobeFollow(rig, satellite, shipDecal, aircraftDecal))
    own(new ConstellationFeed(options.worker, constellation))
    const layerSync = own(
      new LayerSync(
        {
          viewer,
          constellation,
          satellite,
          ships,
          aircraft,
          launchSites: launchSitesLayer,
          ports: portsLayer,
        },
        follow,
      ),
    )
    teardown.push(bindGlobeKeys(rig))
    const health = own(watchRendererHealth(viewer, options.onRendererLost))
    own(
      new TapPicker(
        scene,
        createTapRouter({ constellation, tracking, ships, shipDecal, aircraft, aircraftDecal }),
        () => health.down,
      ),
    )
    teardown.push(
      startFrameLoop({
        viewer,
        constellation,
        ships,
        aircraft,
        satellite,
        follow,
        layerSync,
        rig,
        carry: options.carry,
      }),
    )

    // Rebuilt after a context loss: re-engage the follow lock it interrupted.
    if (options.carry.resumeFollow) {
      options.carry.resumeFollow = false
      follow.resume()
    }
  } catch (err) {
    // A teardown that throws must not replace the build error: its class
    // (renderer vs app) decides what the host shows.
    try {
      dispose()
    } catch (cleanupErr) {
      console.error('[createGlobe] disposing a failed build threw:', cleanupErr)
    }
    throw err
  }
  return { dispose }
}
