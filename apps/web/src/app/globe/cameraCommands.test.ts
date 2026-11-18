import { describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))
import { cameraRequestSeq, requestCamera } from '../../core/ui/cameraStore'
import { useFollow } from '../../core/ui/followStore'
import { bindCameraCommands, bindCameraIntentInputs, runCameraCommand } from './cameraCommands'
import { GlobeFollow } from './follow'

function setup(following: boolean) {
  useFollow.setState({ following }) // set BEFORE GlobeFollow subscribes: no engage fires
  const log: string[] = []
  const rig = {
    follow: vi.fn(),
    unfollow: () => { log.push('unfollow') },
    flyHome: () => { log.push('flyHome') },
    flyTo: (lon: number, lat: number, h: number) => { log.push(`flyTo ${lon} ${lat} ${h}`) },
    zoomStep: (d: 1 | -1) => { log.push(`zoom ${d}`) },
    levelNorth: () => { log.push('level') },
  }
  const decal = () => ({ setPose: vi.fn(), hide: vi.fn() })
  const follow = new GlobeFollow(rig, { active: false }, decal(), decal())
  return { rig, log, follow }
}

describe('camera commands', () => {
  it('HOME releases the lock before it flies', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'home' })
    expect(log).toEqual(['unfollow', 'flyHome'])
    expect(useFollow.getState().following).toBe(false)
    follow.dispose()
  })
  it('locate (flyTo) releases the lock before it flies', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'flyTo', lonDeg: 14.42, latDeg: 50.08, heightM: 500_000 })
    expect(log).toEqual(['unfollow', 'flyTo 14.42 50.08 500000'])
    follow.dispose()
  })
  it('compass and zoom keep the lock', () => {
    const { rig, log, follow } = setup(true)
    runCameraCommand(rig, { kind: 'level' })
    runCameraCommand(rig, { kind: 'zoom', direction: 1 })
    runCameraCommand(rig, { kind: 'zoom', direction: -1 })
    expect(log).toEqual(['level', 'zoom 1', 'zoom -1'])
    expect(useFollow.getState().following).toBe(true)
    follow.dispose()
  })
  it('a free camera flies HOME without touching the lock', () => {
    const { rig, log, follow } = setup(false)
    runCameraCommand(rig, { kind: 'home' })
    expect(log).toEqual(['flyHome'])
    follow.dispose()
  })
  it('bindCameraCommands forwards requests until unbound', () => {
    const { rig, log, follow } = setup(false)
    const unbind = bindCameraCommands(rig)
    requestCamera({ kind: 'home' })
    unbind()
    requestCamera({ kind: 'level' })
    expect(log).toEqual(['flyHome'])
    follow.dispose()
  })
})

describe('bindCameraIntentInputs', () => {
  it('a press or a wheel on the globe counts as a camera move, until unbound', () => {
    const canvas = new EventTarget()
    const unbind = bindCameraIntentInputs(canvas)
    const before = cameraRequestSeq()
    canvas.dispatchEvent(new Event('pointerdown'))
    canvas.dispatchEvent(new Event('wheel'))
    expect(cameraRequestSeq()).toBe(before + 2)
    canvas.dispatchEvent(new Event('pointermove')) // hovering is not a move
    expect(cameraRequestSeq()).toBe(before + 2)
    unbind()
    canvas.dispatchEvent(new Event('pointerdown'))
    expect(cameraRequestSeq()).toBe(before + 2)
  })
})
