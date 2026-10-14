import { describe, expect, it } from 'vitest'
import {
  cssToDrawingBufferPx,
  DEFAULT_MSAA_SAMPLES,
  drawingBufferRatio,
  MAX_RENDER_PIXEL_RATIO,
  msaaSamplesFor,
  PICK_WINDOW_CSS_PX,
  pickWindowCssPx,
  pickWindowPx,
  resolutionScaleFor,
  skipCanvasAntialias,
} from './displayDensity'

describe('resolutionScaleFor', () => {
  it('leaves DPR <= 2 at full device resolution', () => {
    expect(resolutionScaleFor(1)).toBe(1)
    expect(resolutionScaleFor(1.5)).toBe(1)
    expect(resolutionScaleFor(2)).toBe(1)
  })

  it('caps the effective ratio (DPR × scale) at 2 above that', () => {
    for (const dpr of [2.625, 3, 3.5, 4]) {
      expect(dpr * resolutionScaleFor(dpr)).toBeCloseTo(MAX_RENDER_PIXEL_RATIO, 12)
    }
  })

  it('treats a missing or invalid DPR as no cap', () => {
    expect(resolutionScaleFor(Number.NaN)).toBe(1)
    expect(resolutionScaleFor(0)).toBe(1)
  })
})

describe('MSAA / canvas antialias by density', () => {
  it('keeps Cesium defaults below DPR 2', () => {
    expect(msaaSamplesFor(1)).toBe(DEFAULT_MSAA_SAMPLES)
    expect(msaaSamplesFor(1.25)).toBe(DEFAULT_MSAA_SAMPLES)
    expect(skipCanvasAntialias(1)).toBe(false)
  })

  it('turns both off from DPR 2', () => {
    expect(msaaSamplesFor(2)).toBe(1)
    expect(msaaSamplesFor(3)).toBe(1)
    expect(skipCanvasAntialias(2)).toBe(true)
  })
})

describe('drawingBufferRatio', () => {
  it('is drawing-buffer px per CSS px', () => {
    expect(drawingBufferRatio(780, 390)).toBe(2)
    expect(drawingBufferRatio(1440, 1440)).toBe(1)
  })

  it('falls back to 1 for a zero-size canvas', () => {
    expect(drawingBufferRatio(0, 0)).toBe(1)
    expect(drawingBufferRatio(780, 0)).toBe(1)
    expect(drawingBufferRatio(0, 390)).toBe(1)
  })
})

describe('cssToDrawingBufferPx', () => {
  it('is the identity at ratio 1 (desktop unchanged)', () => {
    expect(cssToDrawingBufferPx(9, 1)).toBe(9)
    expect(cssToDrawingBufferPx(28, 1)).toBe(28)
  })

  it('scales by the pixel ratio', () => {
    expect(cssToDrawingBufferPx(32, 2)).toBe(64)
    expect(cssToDrawingBufferPx(10, 1.5)).toBe(15)
  })

  it('counts an invalid ratio as 1', () => {
    expect(cssToDrawingBufferPx(32, 0)).toBe(32)
    expect(cssToDrawingBufferPx(32, -2)).toBe(32)
    expect(cssToDrawingBufferPx(32, Number.NaN)).toBe(32)
    expect(cssToDrawingBufferPx(32, Number.POSITIVE_INFINITY)).toBe(32)
  })
})

describe('pickWindowCssPx', () => {
  it('sizes by the actual pointer type first', () => {
    expect(pickWindowCssPx('touch', false)).toBe(PICK_WINDOW_CSS_PX.coarse)
    expect(pickWindowCssPx('pen', false)).toBe(PICK_WINDOW_CSS_PX.coarse)
    // A mouse on a touch-primary device still gets the precise window.
    expect(pickWindowCssPx('mouse', true)).toBe(PICK_WINDOW_CSS_PX.fine)
  })

  it('falls back to the (pointer: coarse) media query for an unknown type', () => {
    expect(pickWindowCssPx('', true)).toBe(PICK_WINDOW_CSS_PX.coarse)
    expect(pickWindowCssPx('', false)).toBe(PICK_WINDOW_CSS_PX.fine)
  })

  it('gives a finger a window of at least ~a fingertip and a mouse a small one', () => {
    expect(PICK_WINDOW_CSS_PX.coarse).toBeGreaterThanOrEqual(28)
    expect(PICK_WINDOW_CSS_PX.fine).toBeLessThan(PICK_WINDOW_CSS_PX.coarse)
  })
})

describe('pickWindowPx', () => {
  it('is always an odd integer >= 1', () => {
    for (const css of [0, 1, 9, 32]) {
      for (const ratio of [0.5, 1, 1.5, 2, 2.625, 3]) {
        const px = pickWindowPx(css, ratio)
        expect(Number.isInteger(px)).toBe(true)
        expect(px).toBeGreaterThanOrEqual(1)
        expect(px % 2).toBe(1)
      }
    }
  })

  it('converts CSS px to drawing-buffer px, rounding up to odd', () => {
    expect(pickWindowPx(9, 1)).toBe(9) // desktop mouse
    expect(pickWindowPx(32, 1)).toBe(33)
    expect(pickWindowPx(32, 2)).toBe(65) // phone at the DPR-2 cap
    expect(pickWindowPx(9, 2)).toBe(19)
  })

  it('is far wider than Cesium’s 3 px default under a finger at DPR 2', () => {
    // The old pick: 3 drawing-buffer px = 1.5 CSS px at DPR 2.
    expect(pickWindowPx(PICK_WINDOW_CSS_PX.coarse, 2) / 2).toBeGreaterThan(30)
  })
})
