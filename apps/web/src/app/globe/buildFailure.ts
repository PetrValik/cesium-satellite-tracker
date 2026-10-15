/**
 * Why a globe build threw, as GlobeView reports it. A Cesium constructor
 * failing (no WebGL context, a GPU or 2D-canvas allocation refused — most
 * likely mid context-loss rebuild) is the renderer's fault and worth a
 * retry. Anything else (the app's own store wiring, initial feeds or
 * selection throwing on bad data) is a bug a retry cannot fix: it must
 * neither read as a WebGL problem nor spend the context-loss RecoveryBudget.
 */

/** An error a Cesium constructor raised while the globe was being built. */
export class RendererBuildError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'RendererBuildError'
  }
}

/** Run one renderer-construction step; whatever it throws is a renderer failure. */
export function rendererStep<T>(build: () => T): T {
  try {
    return build()
  } catch (err) {
    throw err instanceof RendererBuildError ? err : new RendererBuildError(err)
  }
}

export interface BuildFailure {
  /** `renderer`: a Cesium constructor threw. `app`: anything else in the build. */
  kind: 'renderer' | 'app'
  /** For the engine-error panel. */
  message: string
  /** The error the failing step threw (unwrapped), for console.error. */
  error: unknown
}

export function classifyBuildFailure(err: unknown): BuildFailure {
  if (err instanceof RendererBuildError) {
    return { kind: 'renderer', message: err.message, error: err.cause }
  }
  return { kind: 'app', message: err instanceof Error ? err.message : String(err), error: err }
}
