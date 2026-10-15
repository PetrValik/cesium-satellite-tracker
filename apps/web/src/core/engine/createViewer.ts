import {
  Cartesian3,
  ClockStep,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  JulianDate,
  OpenStreetMapImageryProvider,
  ScreenSpaceEventType,
  Terrain,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium'
import { msaaSamplesFor, resolutionScaleFor, skipCanvasAntialias } from './displayDensity'

type Basemap = 'streets' | 'topo' | 'satellite' // mirrors core/ui/prefsStore Basemap

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
        maximumLevel: 17,
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
 * Engine-layer viewer factory for Orbital Ops. No React in here —
 * app/globe/createGlobe composes it directly.
 *
 * Imagery always comes from the chosen keyless basemap. Two terrain modes:
 * - With `VITE_CESIUM_TOKEN`: Cesium Ion world terrain — the token's only
 *   use.
 * - Without a token (hard requirement): ellipsoid terrain, and Ion is never
 *   touched (no token set, no Ion asset requests, no console error spam).
 */
export function createOrbitalViewer(container: HTMLElement, basemap: Basemap = 'streets'): Viewer {
  const token = import.meta.env.VITE_CESIUM_TOKEN as string | undefined

  // Attribution must stay visible for legal compliance (OSM/Ion credits), so
  // instead of hiding it we hand Cesium a dedicated container that app CSS
  // can restyle small via the "cesium-credits" class.
  const creditContainer = document.createElement('div')
  creditContainer.className = 'cesium-credits'
  container.appendChild(creditContainer)

  // Read once: MSAA and the canvas antialias flag are construction-time
  // choices; resolutionScale is re-applied on DPR change (applyRenderDensity).
  const dpr = window.devicePixelRatio || 1

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
    // Render in device pixels. The default (true) renders at CSS resolution,
    // which on a hi-DPI display upscales the whole canvas — basemap tiles
    // and their labels read as blurry. It does NOT change imagery LOD: tile
    // screen-space error is divided by pixelRatio (QuadtreePrimitive.js,
    // cesium 1.138), so LOD is DPR-independent and the extra pixels only buy
    // edge/text sharpness. applyRenderDensity() caps the ratio at 2 below.
    useBrowserRecommendedResolution: false,
    // At DPR >= 2 the pixel density smooths edges by itself: drop the 4×
    // multisampled scene buffers (Scene default) and the default
    // framebuffer's own antialias buffer. DPR 1 keeps Cesium's defaults.
    msaaSamples: msaaSamplesFor(dpr),
    // Fresh object per call: Context mutates it to fill in its defaults.
    contextOptions: { webgl: { antialias: !skipCanvasAntialias(dpr) } },
    // A render error (in practice: a lost WebGL context on mobile) is
    // recovered by the host rebuilding the viewer via scene.renderError —
    // Cesium's raw error panel must not cover the HUD meanwhile.
    showRenderLoopErrors: false,
  }

  // Snapshot so a failed construction can remove exactly what Viewer added.
  const preexisting = new Set<Element>(Array.from(container.children))

  let viewer: Viewer
  try {
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
  } catch (err) {
    // No viewer owns the credit div yet — don't leave it behind. Viewer.js
    // (1.138) also appends its .cesium-viewer div (holding the half-built
    // CesiumWidget) BEFORE constructing the widget and never removes it on
    // a throw, so a retry would stack a second viewer under the orphan.
    for (const child of Array.from(container.children)) {
      if (!preexisting.has(child) && child.classList.contains('cesium-viewer')) child.remove()
    }
    creditContainer.remove()
    throw err
  }

  // Viewer registers pickAndSelectObject (LEFT_CLICK) and pickAndTrackObject
  // (LEFT_DOUBLE_CLICK) on cesiumWidget.screenSpaceEventHandler — the same
  // instance viewer.screenSpaceEventHandler returns (Viewer.js 1.138). The
  // app picks on its own handler (TapPicker) and never uses selectedEntity /
  // trackedEntity, so the defaults only cost a redundant pick pass per tap,
  // throw an uncaught DeveloperError on a tap while the WebGL context is
  // lost, and let a double-click set trackedEntity behind CameraRig's back.
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_CLICK)
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK)

  applyRenderDensity(viewer, dpr)

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

/**
 * Cap the effective render pixel ratio at 2 (resolutionScale) and match the
 * scene MSAA to the density. Idempotent and cheap — the host calls it again
 * whenever window.devicePixelRatio changes (browser zoom, monitor move).
 */
export function applyRenderDensity(viewer: Viewer, devicePixelRatio: number): void {
  if (viewer.isDestroyed()) return
  // The setter itself no-ops when the value is unchanged.
  viewer.resolutionScale = resolutionScaleFor(devicePixelRatio)
  const samples = msaaSamplesFor(devicePixelRatio)
  // Scene clamps the value to the context maximum; only write on a change.
  if (viewer.scene.msaaSamples !== samples) viewer.scene.msaaSamples = samples
}

/**
 * Destroy a viewer made by createOrbitalViewer, including the credit div
 * it appended to the host container (CesiumWidget.destroy removes only its
 * own inner credit element, leaving one orphan per remount otherwise).
 */
export function destroyOrbitalViewer(viewer: Viewer): void {
  if (viewer.isDestroyed()) return
  const credits = viewer.cesiumWidget.creditContainer
  // CesiumWidget.destroy never destroys the widget's own
  // ScreenSpaceEventHandler (cesium 1.138): its pointer/wheel listeners
  // stayed bound to every rebuilt-away canvas (and, in Firefox's mouse/touch
  // fallback, to `document`). Viewer.destroy skips its removeInputAction
  // calls once it isDestroyed(), so destroying it first is safe.
  const handler = viewer.screenSpaceEventHandler
  if (!handler.isDestroyed()) handler.destroy()
  viewer.destroy()
  credits.remove()
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
