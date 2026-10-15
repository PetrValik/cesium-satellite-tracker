/**
 * GlobeView — the React mount of the globe: the propagation worker's
 * lifetime, one globe per engine epoch, and the engine-error panel.
 * Everything Cesium lives in `./globe/createGlobe` (non-React), which
 * builds the viewer, the layers and their wiring and returns ONE dispose.
 *
 * The engine effect re-runs only when `engineEpoch` bumps: a lost WebGL
 * context (mobile backgrounding / GPU pressure) cannot be restored in
 * place, so recovery disposes the whole globe and builds it again on a
 * fresh canvas in the same container. The propagation worker is NOT part
 * of that: it lives for the component's lifetime (its hashed script URL
 * may no longer be served after a deploy), and each globe only re-wires
 * its message listener and re-sends the catalog. Both effects' cleanups are
 * exact inverses of their setup, so a StrictMode double mount still ends
 * with one viewer and one worker.
 */
import { useEffect, useRef, useState } from 'react'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  REBUILD_RETRY_DELAY_MS,
  RecoveryBudget,
  visibleDelay,
} from '../core/engine/rendererHealth'
import { useFollow } from '../core/ui/followStore'
import { classifyBuildFailure } from './globe/buildFailure'
import { createGlobe, type Globe, type GlobeCarry } from './globe/createGlobe'

/**
 * `init`: the first viewer never came up. `lost`: a running renderer died
 * and rebuilds ran out. `app`: a build failed outside the renderer (a bug).
 */
interface EngineError {
  kind: 'init' | 'lost' | 'app'
  message: string
}

export function GlobeView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [engineError, setEngineError] = useState<EngineError | null>(null)
  /** Bumped to tear the globe down and build it again (context-loss recovery). */
  const [engineEpoch, setEngineEpoch] = useState(0)
  /** What one globe hands the next: last frame time, an interrupted follow lock. */
  const carryRef = useRef<GlobeCarry>({ lastFrameMs: 0, resumeFollow: false })
  /** The rebuild loop guard, shared by context-loss recovery and failed-build retries. */
  const [recoveryBudget] = useState(() => new RecoveryBudget())
  /** The SGP4 propagation worker, owned by the effect below (component lifetime). */
  const workerRef = useRef<Worker | null>(null)

  // Propagation worker: created ONCE per mount, never per engine epoch. A
  // context-loss rebuild in a PWA tab left open across a deploy would
  // otherwise re-fetch the old content-hashed worker URL, which the new
  // service worker no longer caches and the server answers with index.html.
  // Declared before the engine effect so its setup runs first (React runs
  // effects in declaration order) and the engine effect finds it.
  useEffect(() => {
    const worker = new Worker(new URL('../workers/propagation.worker.ts', import.meta.url), {
      type: 'module',
    })
    const onWorkerError = (e: Event) => {
      // Fires for a script that failed to load (404 / HTML served for the
      // hashed URL) as well as an uncaught error inside the worker.
      const detail = e instanceof ErrorEvent && e.message ? `: ${e.message}` : ''
      console.error(
        `[propagation.worker] worker failed${detail} — satellite positions will not update`,
        e,
      )
    }
    const onWorkerMessageError = (e: MessageEvent) => {
      console.error('[propagation.worker] a message from the worker could not be deserialized', e)
    }
    worker.addEventListener('error', onWorkerError)
    worker.addEventListener('messageerror', onWorkerMessageError)
    workerRef.current = worker
    return () => {
      if (workerRef.current === worker) workerRef.current = null
      worker.removeEventListener('error', onWorkerError)
      worker.removeEventListener('messageerror', onWorkerMessageError)
      worker.terminate()
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const worker = workerRef.current
    // The worker effect above always runs first; the guard only keeps a
    // viewer from being built that nothing could feed.
    if (!container || !worker) return

    /**
     * A build that threw — nothing of it is left alive (createGlobe
     * disposed it). A renderer failure on a first build shows the error
     * panel; on a rebuild after context loss it retries on a fresh epoch,
     * within the recovery budget. Anything else is an app bug: its own
     * panel, no retry, no budget spent. Returns the cleanup for a pending retry.
     */
    const failBuild = (err: unknown): (() => void) | undefined => {
      const { kind, message, error } = classifyBuildFailure(err)
      if (kind === 'app') {
        console.error('[GlobeView] the globe build failed outside the renderer:', error)
        setEngineError({ kind: 'app', message })
        return undefined
      }
      console.error('[GlobeView] the renderer failed to build:', error)
      if (engineEpoch === 0 || !recoveryBudget.take(performance.now())) {
        // Init failure is only observable from inside this effect.
        setEngineError({ kind: engineEpoch === 0 ? 'init' : 'lost', message })
        return undefined
      }
      // A rebuild after context loss: on mobile the GPU is often not back
      // yet. Try once more on a fresh epoch after a pause — never while
      // hidden; the budget above caps it.
      const retry = visibleDelay(REBUILD_RETRY_DELAY_MS, () => setEngineEpoch((n) => n + 1))
      retry.arm()
      return retry.cancel
    }

    /**
     * The renderer died: rebuild on a fresh epoch, or show the error panel
     * once rebuilds keep failing.
     */
    const onRendererLost = (reason: string) => {
      if (recoveryBudget.take(performance.now())) {
        carryRef.current.resumeFollow = useFollow.getState().following
      } else {
        setEngineError({ kind: 'lost', message: reason })
      }
      // The bump runs this effect's cleanup either way, so nothing is left
      // running behind the error panel.
      setEngineEpoch((n) => n + 1)
    }

    let globe: Globe
    try {
      globe = createGlobe(container, { worker, carry: carryRef.current, onRendererLost })
    } catch (err) {
      return failBuild(err)
    }
    return () => globe.dispose()
  }, [engineEpoch, recoveryBudget])

  if (engineError) {
    return (
      <div className="engine-error">
        <div className="engine-error-panel">
          {engineError.kind === 'app' ? (
            <>
              <h1>GLOBE FAULT</h1>
              <p>The globe could not be built: {engineError.message}</p>
              <p>An application error, not a WebGL problem. Reload the page; the console has details.</p>
            </>
          ) : engineError.kind === 'lost' ? (
            <>
              <h1>RENDERER LOST</h1>
              <p>The WebGL renderer was lost and could not be restored: {engineError.message}</p>
              <p>Reload the page to restart it.</p>
            </>
          ) : (
            <>
              <h1>RENDERER OFFLINE</h1>
              <p>Cesium failed to initialize: {engineError.message}</p>
              <p>Try a browser with WebGL 2 support.</p>
            </>
          )}
        </div>
      </div>
    )
  }
  return <div ref={containerRef} className="globe-root" />
}
