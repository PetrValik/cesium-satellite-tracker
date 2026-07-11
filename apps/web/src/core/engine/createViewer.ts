import {
  Cartesian3,
  ClockStep,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  JulianDate,
  OpenStreetMapImageryProvider,
  Terrain,
  Viewer,
} from 'cesium'

/**
 * Engine-layer viewer factory for Orbital Ops. No React in here — components
 * consume this through thin hooks.
 *
 * Two provisioning modes:
 * - With `VITE_CESIUM_TOKEN`: Cesium Ion world terrain + default Ion imagery.
 * - Without a token (hard requirement): keyless OpenStreetMap imagery +
 *   ellipsoid terrain, and Ion is never touched (no token set, no Ion asset
 *   requests, no console error spam).
 */
export function createOrbitalViewer(container: HTMLElement): Viewer {
  const token = import.meta.env.VITE_CESIUM_TOKEN as string | undefined

  // Attribution must stay visible for legal compliance (OSM/Ion credits), so
  // instead of hiding it we hand Cesium a dedicated container that app CSS
  // can restyle small via the "cesium-credits" class.
  const creditContainer = document.createElement('div')
  creditContainer.className = 'cesium-credits'
  container.appendChild(creditContainer)

  const baseOptions: Viewer.ConstructorOptions = {
    // All default widgets off — the app ships its own HUD.
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    vrButton: false,
    creditContainer,
    // The app animates continuously (satellites move every frame), so
    // explicit-render mode must stay off.
    requestRenderMode: false,
    // The sim-clock store is the source of truth; an external loop calls
    // syncViewerClock() — Cesium's clock must never advance time itself.
    shouldAnimate: false,
  }

  let viewer: Viewer
  if (token) {
    Ion.defaultAccessToken = token
    viewer = new Viewer(container, {
      ...baseOptions,
      terrain: Terrain.fromWorldTerrain(),
    })
  } else {
    viewer = new Viewer(container, {
      ...baseOptions,
      baseLayer: new ImageryLayer(
        new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
      ),
      terrainProvider: new EllipsoidTerrainProvider(),
    })
  }

  const scene = viewer.scene
  scene.globe.enableLighting = true // day/night terminator
  // Occlude billboards/points behind the globe — Cesium's default (false)
  // renders far-side objects through the planet. Surface-level icons carry a
  // small camera-ward eyeOffset in their layers to avoid half-sinking.
  scene.globe.depthTestAgainstTerrain = true
  scene.globe.showGroundAtmosphere = true
  if (scene.skyAtmosphere !== undefined) {
    scene.skyAtmosphere.show = true
  }

  // Belt and suspenders on top of shouldAnimate=false: with
  // SYSTEM_CLOCK_MULTIPLIER, Clock.tick() leaves currentTime untouched while
  // paused (SYSTEM_CLOCK would overwrite it with wall-clock time every frame).
  viewer.clock.shouldAnimate = false
  viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER

  // Whole-Earth default view centered over Europe.
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(15, 35, 28e6),
  })

  return viewer
}

// Reused across calls — syncViewerClock runs every sim tick and must not
// allocate. Date#setTime lets us avoid a `new Date(epochMs)` per call.
const scratchSyncDate = new Date(0)

/**
 * Push sim time (ms since Unix epoch) into the viewer clock. One-way sync:
 * the sim-clock store drives Cesium, never the reverse.
 */
export function syncViewerClock(viewer: Viewer, epochMs: number): void {
  if (viewer.isDestroyed()) return
  scratchSyncDate.setTime(epochMs)
  // Clock#currentTime's setter stores the reference it is handed (no clone),
  // so a shared scratch JulianDate must never be assigned to it. Instead,
  // write into the clock's own JulianDate via the `result` parameter; the
  // subsequent assignment through the setter is then an identity no-op.
  const clock = viewer.clock
  clock.currentTime = JulianDate.fromDate(scratchSyncDate, clock.currentTime)
}
