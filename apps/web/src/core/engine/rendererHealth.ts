/**
 * WebGL renderer health: context-loss detection, the rebuild request and
 * the rebuild budget. @cesium/engine 1.138 has no webglcontextlost/restored
 * handling at all, and its GPU resources cannot be re-created in place, so
 * a lost context means the whole engine is torn down and built again on a
 * fresh canvas. This module only detects that and asks for it; the host
 * owns the rebuild and its error panel. No React, no slice knowledge.
 */
import type { Viewer } from 'cesium'

/** A lost WebGL context gets this long to come back by itself before the engine is rebuilt anyway. */
const CONTEXT_RESTORE_GRACE_MS = 1500
/** More than this many rebuilds within RECOVERY_WINDOW_MS → stop and show the error panel. */
export const MAX_RECOVERIES = 3
export const RECOVERY_WINDOW_MS = 60_000
/** A rebuild whose viewer failed to construct is retried after this pause (GPU not back yet). */
export const REBUILD_RETRY_DELAY_MS = 1000

/**
 * The rebuild loop guard: at most `max` rebuilds per `windowMs`. One budget
 * for both context-loss recovery and the retry of a failed rebuild, so the
 * host keeps one for its whole mount, across engines.
 */
export class RecoveryBudget {
  private readonly _max: number
  private readonly _windowMs: number
  /** Timestamps of the rebuilds still inside the window. */
  private _log: number[] = []

  constructor(max: number = MAX_RECOVERIES, windowMs: number = RECOVERY_WINDOW_MS) {
    this._max = max
    this._windowMs = windowMs
  }

  /** Log one rebuild at `nowMs` (performance.now()); true while within budget. */
  take(nowMs: number): boolean {
    this._log = this._log.filter((t) => nowMs - t < this._windowMs)
    this._log.push(nowMs)
    return this._log.length <= this._max
  }
}

/** The slice of `document` a visible-only timer reads (a fake in tests). */
export type VisibilitySource = Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>

interface VisibleDelay {
  /** Start the delay unless it is already pending, has fired, or was cancelled. */
  arm(): void
  /** Stop for good: clears a pending delay and the visibility listener. */
  cancel(): void
}

/**
 * A one-shot timer that only runs while the page is visible: `fire` is
 * called once, `delayMs` after `arm()`, and never while hidden — a
 * backgrounded tab may not get a GPU context at all. Hidden at arm time, or
 * gone hidden when the delay ends, it starts over when the page is shown
 * again.
 */
export function visibleDelay(
  delayMs: number,
  fire: () => void,
  doc: VisibilitySource = document,
): VisibleDelay {
  let timer: ReturnType<typeof setTimeout> | undefined
  let listening = false
  let done = false

  const stopListening = () => {
    if (!listening) return
    listening = false
    doc.removeEventListener('visibilitychange', arm)
  }

  function arm(): void {
    if (done) return
    if (!listening) {
      listening = true
      doc.addEventListener('visibilitychange', arm)
    }
    if (timer !== undefined || doc.hidden) return
    timer = setTimeout(() => {
      timer = undefined
      // Went hidden during the delay: the visibility listener re-arms.
      if (doc.hidden) return
      done = true
      stopListening()
      fire()
    }, delayMs)
  }

  return {
    arm,
    cancel: () => {
      done = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      stopListening()
    },
  }
}

interface RendererHealth {
  /**
   * True once the context is lost or a rebuild was requested. The drawing
   * buffer is dead then: a pick finds nothing, and an "empty tap" would
   * drop the very selection the rebuild is meant to keep.
   */
  readonly down: boolean
  dispose(): void
}

/**
 * Watch `viewer`'s canvas and render loop. `onRebuild(reason)` is called at
 * most once per watcher: after a lost context did not come back within
 * CONTEXT_RESTORE_GRACE_MS, when it was restored (the engine's GPU
 * resources died with it all the same), or on a render error that is not
 * a lost context. Never while the page is hidden.
 */
export function watchRendererHealth(
  viewer: Viewer,
  onRebuild: (reason: string) => void,
): RendererHealth {
  const canvas = viewer.scene.canvas
  let contextLost = false
  let rebuildRequested = false

  const requestRebuild = (reason: string) => {
    if (rebuildRequested) return
    rebuildRequested = true
    grace.cancel()
    onRebuild(reason)
  }
  // Wait for webglcontextrestored, or rebuild after the grace period.
  const grace = visibleDelay(CONTEXT_RESTORE_GRACE_MS, () => requestRebuild('WebGL context lost'))

  const isContextLost = () => {
    // getContext() hands back the canvas's existing context (Cesium asks
    // for webgl2 first, webgl as the fallback).
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    return gl === null || gl.isContextLost()
  }
  const onContextLost = (e: Event) => {
    // Without preventDefault the browser never fires webglcontextrestored.
    e.preventDefault()
    contextLost = true
    grace.arm()
  }
  const onContextRestored = () => {
    // The context is still gone for this engine (its GPU resources died
    // with it), so stay marked lost. Same rule as the grace period: never
    // rebuild while hidden — arming waits for the page to be shown.
    contextLost = true
    if (document.hidden) {
      grace.arm()
      return
    }
    requestRebuild('WebGL context lost')
  }
  // CesiumWidget's own renderError listener has already stopped its render
  // loop; showRenderLoopErrors is off, so this is the only report.
  const onRenderError = (_scene: unknown, error: unknown) => {
    if (contextLost || isContextLost()) {
      contextLost = true
      grace.arm()
      return
    }
    console.error('[cesium] render error', error)
    requestRebuild(error instanceof Error ? error.message : String(error))
  }
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  const removeRenderErrorListener = viewer.scene.renderError.addEventListener(onRenderError)

  return {
    get down() {
      return contextLost || rebuildRequested
    },
    dispose: () => {
      grace.cancel()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      removeRenderErrorListener()
    },
  }
}
