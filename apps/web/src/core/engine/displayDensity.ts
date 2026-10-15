/**
 * Display-density math for the engine: the render-resolution cap, the MSAA
 * choice, and the size of the tap/click pick window. Pure functions with no
 * Cesium import, so they are unit-testable without WebGL.
 *
 * Units, verified against cesium 1.138 (@cesium/engine 22.3.0):
 * - `scene.pixelRatio` = devicePixelRatio × resolutionScale when
 *   useBrowserRecommendedResolution is false (CesiumWidget.js
 *   configurePixelRatio), and the drawing buffer is the canvas client size
 *   × that ratio.
 * - Billboard/label sizes and pixelOffsets, polyline widths and point sizes
 *   are already CSS px at ANY ratio: their shaders multiply by
 *   czm_pixelRatio (czm_metersPerPixel in BillboardCollectionVS.glsl — labels
 *   are SDF glyph billboards — PolylineCommon.glsl, and
 *   PointPrimitiveCollectionVS.glsl). Layers need no DPR compensation.
 * - The pick rectangle is NOT: Scene.pick/drillPick width and height are
 *   drawing-buffer px (Picking.js computePickingDrawingBufferRectangle,
 *   default 3), so a CSS-sized pick window must be converted with the
 *   drawing-buffer / CSS ratio — the same ratio Cesium applies to the tap
 *   position (SceneTransforms.transformWindowToDrawingBuffer). Not
 *   window.devicePixelRatio, which ignores the cap; scene.pixelRatio is
 *   @private in 1.138 and absent from the typings.
 */

/**
 * Highest effective render pixel ratio. Above 2 the extra pixels are near
 * invisible on a phone but cost fill and GPU memory on every pass (DPR 3 is
 * 9× the CSS pixel count), and memory pressure is the main reason mobile
 * browsers drop the WebGL context.
 */
export const MAX_RENDER_PIXEL_RATIO = 2

/** Cesium's own Scene MSAA default, kept wherever the cap does not bite. */
export const DEFAULT_MSAA_SAMPLES = 4

/**
 * At or above this device pixel ratio the scene renders without MSAA: the
 * pixel density itself smooths edges, and 4× multisampled colour + depth at
 * that resolution is the largest single GPU allocation in the scene.
 */
const NO_MSAA_MIN_DPR = 2

/** `viewer.resolutionScale` that caps the effective pixel ratio at MAX_RENDER_PIXEL_RATIO. */
export function resolutionScaleFor(devicePixelRatio: number): number {
  // `!(a > b)` also catches NaN; DPR <= 2 renders at full device resolution.
  if (!(devicePixelRatio > MAX_RENDER_PIXEL_RATIO)) return 1
  return MAX_RENDER_PIXEL_RATIO / devicePixelRatio
}

/** Scene MSAA sample count for a device pixel ratio (1 = MSAA off). */
export function msaaSamplesFor(devicePixelRatio: number): number {
  return devicePixelRatio >= NO_MSAA_MIN_DPR ? 1 : DEFAULT_MSAA_SAMPLES
}

/** True when the WebGL default framebuffer should skip its own antialias buffer. */
export function skipCanvasAntialias(devicePixelRatio: number): boolean {
  return devicePixelRatio >= NO_MSAA_MIN_DPR
}

/**
 * Drawing-buffer px per CSS px, from `scene.drawingBufferWidth` and
 * `scene.canvas.clientWidth`. A zero-size (hidden) canvas reports 1.
 */
export function drawingBufferRatio(drawingBufferWidth: number, clientWidth: number): number {
  const ratio = drawingBufferWidth / clientWidth
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/** CSS px → drawing-buffer px for a pixel ratio (invalid ratios count as 1). */
export function cssToDrawingBufferPx(cssPx: number, pixelRatio: number): number {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  return cssPx * ratio
}

/**
 * Pick window edge in CSS px. Coarse (finger/stylus): a 32 px square, i.e.
 * anything within ±16 px of the touch point — roughly the contact patch of
 * a fingertip. Fine (mouse): 9 px, so the 1.5–2.5 px satellite dots at
 * whole-globe range stay clickable without stealing clicks meant for
 * empty space.
 */
export const PICK_WINDOW_CSS_PX = { coarse: 32, fine: 9 } as const

/**
 * Most distinct objects one tap collects. Scene.drillPick gathers up to this
 * many objects per pick pass, nearest the window centre first, and only
 * runs another pass (with the earlier hits hidden) while it has found fewer.
 */
export const PICK_LIMIT = 8

/**
 * CSS edge of the pick window for the pointer that produced the tap.
 * `pointerType` is PointerEvent.pointerType of the last press on the canvas
 * ('' when unknown, e.g. no pointer events); `coarseFallback` is the
 * `(pointer: coarse)` media query, used only when the type is unknown.
 */
export function pickWindowCssPx(pointerType: string, coarseFallback: boolean): number {
  if (pointerType === 'touch' || pointerType === 'pen') return PICK_WINDOW_CSS_PX.coarse
  if (pointerType === 'mouse') return PICK_WINDOW_CSS_PX.fine
  return coarseFallback ? PICK_WINDOW_CSS_PX.coarse : PICK_WINDOW_CSS_PX.fine
}

/**
 * Pick window edge in drawing-buffer px: an odd integer >= 1 (Cesium centres
 * the rectangle on the pointer pixel and walks it in a spiral, which wastes
 * iterations on even sizes — Picking.js / PickFramebuffer.js).
 */
export function pickWindowPx(cssPx: number, pixelRatio: number): number {
  const px = Math.max(1, Math.round(cssToDrawingBufferPx(cssPx, pixelRatio)))
  return px % 2 === 1 ? px : px + 1
}
