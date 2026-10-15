import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Scene } from 'cesium'
import { drawingBufferRatio, PICK_LIMIT, pickWindowCssPx, pickWindowPx } from './displayDensity'

/**
 * ONE drill pick per globe tap, every hit handed to the host nearest-first.
 * The host owns picking (createViewer strips Viewer's default click
 * actions); this owns the Cesium side of it — the event handler, the
 * pointer-sized pick window and the pass itself — and knows nothing about
 * what the hits mean.
 */
export class TapPicker {
  private readonly _scene: Scene
  private readonly _canvas: HTMLCanvasElement
  private readonly _handler: ScreenSpaceEventHandler
  /** `(pointer: coarse)`: sizes the window when the pointer type is unknown. */
  private readonly _coarsePointer = window.matchMedia('(pointer: coarse)')
  /**
   * The pointer that pressed last sizes the pick window (finger vs mouse —
   * a touch laptop has both).
   */
  private _lastPointerType = ''

  /**
   * `onTap(hits)` runs once per tap, also for an empty one (no hits).
   * `paused()` true skips the tap entirely — no pick, no `onTap`: a dead
   * drawing buffer (lost context) reads as empty and would drop a selection.
   */
  constructor(
    scene: Scene,
    onTap: (hits: readonly unknown[]) => void,
    paused: () => boolean,
  ) {
    this._scene = scene
    this._canvas = scene.canvas
    // The handler first: nothing after it can throw, so a failed
    // construction leaves no listener behind.
    this._handler = new ScreenSpaceEventHandler(this._canvas)
    this._handler.setInputAction((movement: ScreenSpaceEventHandler.PositionedEvent) => {
      if (this._scene.isDestroyed() || paused()) return
      // Pick rectangle is in drawing-buffer px (Picking.js, cesium 1.138):
      // convert the CSS window with the ratio Cesium itself applies to the
      // tap position (includes the resolutionScale cap).
      const size = pickWindowPx(
        pickWindowCssPx(this._lastPointerType, this._coarsePointer.matches),
        drawingBufferRatio(this._scene.drawingBufferWidth, this._canvas.clientWidth),
      )
      // drillPick collects up to PICK_LIMIT distinct objects in one pass,
      // nearest the tap first (PickFramebuffer spiral). Only when it found
      // fewer does it run another pass to look behind them, so an empty
      // tap costs exactly one pass.
      onTap(this._scene.drillPick(movement.position, PICK_LIMIT, size, size))
    }, ScreenSpaceEventType.LEFT_CLICK)
    this._canvas.addEventListener('pointerdown', this._onPointerDown, {
      capture: true,
      passive: true,
    })
  }

  dispose(): void {
    this._canvas.removeEventListener('pointerdown', this._onPointerDown, { capture: true })
    if (!this._handler.isDestroyed()) this._handler.destroy()
  }

  private readonly _onPointerDown = (e: PointerEvent): void => {
    this._lastPointerType = e.pointerType
  }
}
