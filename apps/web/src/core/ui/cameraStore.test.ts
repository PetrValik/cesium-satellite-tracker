import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindCameraHandler, headingMoved, publishHeading, requestCamera, useCameraHeading } from './cameraStore'

let unbind: (() => void) | null = null
afterEach(() => { unbind?.(); unbind = null })

describe('camera commands', () => {
  it('hands each request to the bound handler exactly once, in order', () => {
    const handler = vi.fn()
    unbind = bindCameraHandler(handler)
    requestCamera({ kind: 'zoom', direction: 1 })
    requestCamera({ kind: 'home' })
    expect(handler.mock.calls).toEqual([[{ kind: 'zoom', direction: 1 }], [{ kind: 'home' }]])
  })
  it('drops a request while no globe is bound and never replays it', () => {
    requestCamera({ kind: 'home' })
    const handler = vi.fn()
    unbind = bindCameraHandler(handler)
    expect(handler).not.toHaveBeenCalled()
  })
  it('stops delivering after unbind', () => {
    const handler = vi.fn()
    bindCameraHandler(handler)()
    requestCamera({ kind: 'level' })
    expect(handler).not.toHaveBeenCalled()
  })
  it('a newer binding replaces the old one; the stale unbind leaves it bound', () => {
    const old = vi.fn(), next = vi.fn()
    const unbindOld = bindCameraHandler(old)
    unbind = bindCameraHandler(next)
    unbindOld()
    requestCamera({ kind: 'level' })
    expect(old).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })
})

describe('headingMoved', () => {
  it('is true from a 1° change, measured across north too', () => {
    expect(headingMoved(0, 0.99)).toBe(false)
    expect(headingMoved(0, 1)).toBe(true)
    expect(headingMoved(10, 9)).toBe(true)
    expect(headingMoved(359.6, 0.3)).toBe(false) // 0.7° across north
    expect(headingMoved(359.5, 0.6)).toBe(true)  // 1.1° across north
    expect(headingMoved(0.4, 359.5)).toBe(false)
    expect(headingMoved(0, 360)).toBe(false)
    expect(headingMoved(90, 270)).toBe(true)
  })
})

describe('publishHeading', () => {
  beforeEach(() => useCameraHeading.setState({ headingDeg: 0 }))
  it('sets the store only when the heading moved at least 1°', () => {
    let sets = 0
    const unsub = useCameraHeading.subscribe(() => { sets++ })
    publishHeading(0.5)
    expect(sets).toBe(0)
    publishHeading(1.2)
    expect(useCameraHeading.getState().headingDeg).toBe(1.2)
    publishHeading(1.9)
    expect(sets).toBe(1)
    publishHeading(359.9) // 1.3° back across north
    expect(sets).toBe(2)
    expect(useCameraHeading.getState().headingDeg).toBe(359.9)
    unsub()
  })
})
