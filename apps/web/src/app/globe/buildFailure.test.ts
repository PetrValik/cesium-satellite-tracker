import { describe, expect, it } from 'vitest'
import { classifyBuildFailure, RendererBuildError, rendererStep } from './buildFailure'

describe('classifyBuildFailure', () => {
  it('reports a throw from a renderer step as a renderer failure, unwrapped', () => {
    const gpu = new Error('2D canvas context unavailable for icon sprites')
    let thrown: unknown
    try {
      rendererStep(() => {
        throw gpu
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(RendererBuildError)
    expect(classifyBuildFailure(thrown)).toEqual({
      kind: 'renderer',
      message: gpu.message,
      error: gpu,
    })
  })

  it('reports anything thrown outside a renderer step as an app failure', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'latDeg')")
    expect(classifyBuildFailure(bug)).toEqual({ kind: 'app', message: bug.message, error: bug })
  })

  it('handles non-Error throws on both paths', () => {
    expect(classifyBuildFailure('bad feed')).toEqual({
      kind: 'app',
      message: 'bad feed',
      error: 'bad feed',
    })
    expect(() =>
      rendererStep(() => {
        throw 'context lost'
      }),
    ).toThrow(RendererBuildError)
    expect(classifyBuildFailure(new RendererBuildError('context lost'))).toMatchObject({
      kind: 'renderer',
      message: 'context lost',
    })
  })

  it('does not re-wrap a renderer failure from a nested step', () => {
    const inner = new RendererBuildError(new Error('WebGL unavailable'))
    let thrown: unknown
    try {
      rendererStep(() => {
        throw inner
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBe(inner)
  })

  it('passes a step result through untouched', () => {
    const value = { viewer: true }
    expect(rendererStep(() => value)).toBe(value)
  })
})
