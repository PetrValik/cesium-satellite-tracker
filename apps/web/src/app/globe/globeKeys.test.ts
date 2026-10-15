import { beforeEach, describe, expect, it, vi } from 'vitest'

// The domain stores import lib/api; nothing here fetches.
vi.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { useSimClock } from '../../core/sim/simClock'
import { useFollow } from '../../core/ui/followStore'
import { useHud } from '../../core/ui/hudStore'
import { useMode } from '../../core/ui/modeStore'
import { useSheet } from '../../core/ui/sheetStore'
import { useShips } from '../../features/maritime/shipsStore'
import { globeKeyHandlers, timeControlsActive, type GlobeKeyEvent } from './globeKeys'

function key(code: string, extra: Partial<GlobeKeyEvent> = {}): GlobeKeyEvent {
  return {
    code,
    key: '',
    target: null,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    ...extra,
  }
}

function setup() {
  const rig = { press: vi.fn(), release: vi.fn(), releaseAll: vi.fn() }
  return { rig, ...globeKeyHandlers(rig) }
}

beforeEach(() => {
  useMode.setState({
    mode: 'orbital',
    satellitesVisible: true,
    shipsVisible: false,
    aircraftVisible: false,
    helpOpen: false,
    settingsOpen: false,
  })
  useHud.setState({ hidden: false })
  useSheet.setState({ sheet: null })
  useFollow.setState({ following: false })
  useShips.setState({ selectedMmsi: null })
  useSimClock.setState({ rate: 1, playing: true })
})

describe('globe keys', () => {
  it('ignores keys typed into a field, including a select', () => {
    const { onKeyDown } = setup()
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      onKeyDown(key('Digit2', { target: { tagName } as unknown as EventTarget }))
    }
    expect(useMode.getState().shipsVisible).toBe(false)
  })

  it('routes held movement keys to the rig and releases them on keyup / blur', () => {
    const { rig, onKeyDown, onKeyUp, onBlur } = setup()
    const e = key('KeyW')
    onKeyDown(e)
    expect(rig.press).toHaveBeenCalledWith('KeyW')
    expect(e.preventDefault).toHaveBeenCalled()
    onKeyUp({ code: 'KeyW' })
    expect(rig.release).toHaveBeenCalledWith('KeyW')
    onBlur()
    expect(rig.releaseAll).toHaveBeenCalled()
  })

  it('steps the sim rate one notch per , / . and stops at either end', () => {
    const { onKeyDown } = setup()
    onKeyDown(key('Period'))
    expect(useSimClock.getState().rate).toBe(10)
    useSimClock.setState({ rate: 3600 })
    onKeyDown(key('Period'))
    expect(useSimClock.getState().rate).toBe(3600)
    useSimClock.setState({ rate: -60 })
    onKeyDown(key('Comma'))
    expect(useSimClock.getState().rate).toBe(-60)
    useSimClock.setState({ rate: 1 })
    onKeyDown(key('Comma'))
    expect(useSimClock.getState().rate).toBe(-60)
  })

  it('time keys go quiet with the transport bar (ORBITAL hidden, or HUD hidden)', () => {
    const { onKeyDown } = setup()
    expect(timeControlsActive()).toBe(true)
    useMode.setState({ satellitesVisible: false })
    expect(timeControlsActive()).toBe(false)
    onKeyDown(key('Space'))
    expect(useSimClock.getState().playing).toBe(true)
    useMode.setState({ satellitesVisible: true })
    useHud.setState({ hidden: true })
    onKeyDown(key('Period'))
    expect(useSimClock.getState().rate).toBe(1)
    useHud.setState({ hidden: false })
    const space = key('Space')
    onKeyDown(space)
    expect(useSimClock.getState().playing).toBe(false)
    expect(space.preventDefault).toHaveBeenCalled()
  })

  it('Escape peels one layer per press: help, sheet, follow lock, then the selection', () => {
    const { onKeyDown } = setup()
    useMode.setState({ mode: 'maritime', shipsVisible: true, helpOpen: true })
    useSheet.setState({ sheet: 'details' })
    useShips.setState({ selectedMmsi: 211_000_000 })
    useFollow.setState({ following: true })
    onKeyDown(key('Escape'))
    expect(useMode.getState().helpOpen).toBe(false)
    expect(useSheet.getState().sheet).toBe('details')
    onKeyDown(key('Escape'))
    expect(useSheet.getState().sheet).toBeNull()
    expect(useFollow.getState().following).toBe(true)
    onKeyDown(key('Escape'))
    expect(useFollow.getState().following).toBe(false)
    expect(useShips.getState().selectedMmsi).toBe(211_000_000)
    onKeyDown(key('Escape'))
    expect(useShips.getState().selectedMmsi).toBeNull()
  })

  it('digits toggle the domains; F toggles follow only with a selection; modifiers and repeats pass', () => {
    const { onKeyDown } = setup()
    onKeyDown(key('Digit2'))
    expect(useMode.getState().shipsVisible).toBe(true)
    expect(useMode.getState().mode).toBe('maritime')
    onKeyDown(key('KeyF'))
    expect(useFollow.getState().following).toBe(false)
    useShips.setState({ selectedMmsi: 211_000_000 })
    onKeyDown(key('KeyF', { repeat: true }))
    onKeyDown(key('KeyF', { ctrlKey: true }))
    expect(useFollow.getState().following).toBe(false)
    onKeyDown(key('KeyF'))
    expect(useFollow.getState().following).toBe(true)
  })

  it('H and ? toggle help', () => {
    const { onKeyDown } = setup()
    onKeyDown(key('KeyH'))
    expect(useMode.getState().helpOpen).toBe(true)
    onKeyDown(key('Slash', { key: '?' }))
    expect(useMode.getState().helpOpen).toBe(false)
  })
})
