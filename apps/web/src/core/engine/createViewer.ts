import {
  Cartesian3,
  ClockStep,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  JulianDate,
  OpenStreetMapImageryProvider,
  Terrain,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'

export type Basemap = 'streets' | 'topo' | 'satellite'

/**
 * Keyless basemap providers. TOPO carries hillshaded relief ("mountains"),
 * SATELLITE is Esri World Imagery — both work without any token; a Cesium
 * Ion token additionally enables true 3D terrain underneath.
 */
function basemapProvider(basemap: Basemap) {
  switch (basemap) {
    case 'topo':
      return new UrlTemplateImageryProvider({
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        subdomains: ['a', 'b', 'c'],
        maximumLevel: 16,
        credit: 'Map data © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)',
      })
    case 'satellite':
      return new UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 18,
        credit: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      })
    default:
      return new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })
  }
}

/** Swap the base imagery layer in place (satellite/topo/streets). */
export function setViewerBasemap(viewer: Viewer, basemap: Basemap): void {
  if (viewer.isDestroyed()) return
  const layers = viewer.imageryLayers
  const oldBase = layers.length > 0 ? layers.get(0) : undefined
  layers.add(new ImageryLayer(basemapProvider(basemap)), 0)
  if (oldBase !== undefined) layers.remove(oldBase, true)
}

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
export function createOrbitalViewer(container: HTMLElement, basemap: Basemap = 'streets'): Viewer {
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
    // Token adds true 3D terrain; imagery still comes from the keyless
    // basemap choice so the look is consistent with the token-free mode.
    Ion.defaultAccessToken = token
    viewer = new Viewer(container, {
      ...baseOptions,
      baseLayer: new ImageryLayer(basemapProvider(basemap)),
      terrain: Terrain.fromWorldTerrain(),
    })
  } else {
    viewer = new Viewer(container, {
      ...baseOptions,
      baseLayer: new ImageryLayer(basemapProvider(basemap)),
      terrainProvider: new EllipsoidTerrainProvider(),
    })
  }

  const scene = viewer.scene
  scene.globe.enableLighting = true // day/night terminator
  // Occlude billboards/points behind the globe — Cesium's default (false)
  // renders far-side objects through the planet. Surface-level icons carry a
  // small camera-ward eyeOffset in their layers to avoid half-sinking.
  scene.globe.depthTestAgainstTerrain = true
  // Ground atmosphere bleaches the surface into "frosted glass" at grazing
  // angles (read as a transparent planet). The sky-atmosphere limb halo
  // below carries the look on its own.
  scene.globe.showGroundAtmosphere = false
  // Fog both washes out grazing-angle terrain AND culls far tiles from
  // rendering — culled tiles write no depth, so billboards/labels BEYOND the
  // horizon showed through the planet. With fog off the globe renders (and
  // occludes) all the way to the limb.
  scene.fog.enabled = false
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
