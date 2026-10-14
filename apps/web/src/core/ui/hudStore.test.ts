import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { handleHudKey, showHudOnModalOpen, useHud, type HudKeyEvent } from './hudStore'
import { useMode } from './modeStore'
import { useSheet } from './sheetStore'

/** A keydown on the page body unless overridden (tests run in plain node). */
function key(code: string, extra: Partial<HudKeyEvent> = {}): HudKeyEvent {
  return {
    code,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: { tagName: 'BODY', isContentEditable: false } as unknown as EventTarget,
    ...extra,
  }
}

let unbind: (() => void) | null = null

beforeEach(() => {
  useHud.setState({ hidden: false })
  useSheet.setState({ sheet: null })
  useMode.setState({ helpOpen: false, settingsOpen: false })
})

afterEach(() => {
  unbind?.()
  unbind = null
})

describe('hudStore', () => {
  it('starts with the controls showing', () => {
    expect(useHud.getInitialState().hidden).toBe(false)
  })

  it('toggle hides and shows', () => {
    useHud.getState().toggle()
    expect(useHud.getState().hidden).toBe(true)
    useHud.getState().toggle()
    expect(useHud.getState().hidden).toBe(false)
  })

  it('hiding closes the open sheet and both dialogs', () => {
    useSheet.getState().toggle('layers')
    useMode.setState({ helpOpen: true, settingsOpen: true })
    useHud.getState().hide()
    expect(useSheet.getState().sheet).toBeNull()
    expect(useMode.getState().helpOpen).toBe(false)
    expect(useMode.getState().settingsOpen).toBe(false)
  })

  it('showing does not reopen what hiding closed', () => {
    useSheet.getState().toggle('picture')
    useHud.getState().hide()
    useHud.getState().show()
    expect(useSheet.getState().sheet).toBeNull()
  })
})

describe('handleHudKey', () => {
  it('U toggles both ways', () => {
    expect(handleHudKey(key('KeyU'))).toBe(true)
    expect(useHud.getState().hidden).toBe(true)
    expect(handleHudKey(key('KeyU'))).toBe(true)
    expect(useHud.getState().hidden).toBe(false)
  })

  it('ignores U while typing in a field', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const target = { tagName, isContentEditable: false } as unknown as EventTarget
      expect(handleHudKey(key('KeyU', { target }))).toBe(false)
    }
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget
    expect(handleHudKey(key('KeyU', { target: editable }))).toBe(false)
    expect(useHud.getState().hidden).toBe(false)
  })

  it('ignores modified and auto-repeated U', () => {
    expect(handleHudKey(key('KeyU', { ctrlKey: true }))).toBe(false)
    expect(handleHudKey(key('KeyU', { metaKey: true }))).toBe(false)
    expect(handleHudKey(key('KeyU', { altKey: true }))).toBe(false)
    expect(handleHudKey(key('KeyU', { repeat: true }))).toBe(false)
    expect(useHud.getState().hidden).toBe(false)
  })

  it('Escape while hidden shows and is consumed', () => {
    useHud.getState().hide()
    expect(handleHudKey(key('Escape'))).toBe(true)
    expect(useHud.getState().hidden).toBe(false)
  })

  it('Escape while showing is left to the globe (follow release / deselect)', () => {
    expect(handleHudKey(key('Escape'))).toBe(false)
    expect(useHud.getState().hidden).toBe(false)
  })

  it('other keys pass through while hidden', () => {
    useHud.getState().hide()
    for (const code of ['KeyF', 'KeyH', 'Space', 'Digit1', 'KeyW']) {
      expect(handleHudKey(key(code))).toBe(false)
    }
    expect(useHud.getState().hidden).toBe(true)
  })
})

describe('showHudOnModalOpen', () => {
  it('opening HELP while hidden brings the controls back', () => {
    unbind = showHudOnModalOpen()
    useHud.getState().hide()
    useMode.getState().toggleHelp()
    expect(useHud.getState().hidden).toBe(false)
  })

  it('opening COLORS while hidden brings the controls back', () => {
    unbind = showHudOnModalOpen()
    useHud.getState().hide()
    useMode.getState().toggleSettings()
    expect(useHud.getState().hidden).toBe(false)
  })

  it('closing a dialog or changing layers leaves the HUD hidden', () => {
    unbind = showHudOnModalOpen()
    useHud.getState().hide()
    useMode.getState().closeHelp()
    useMode.setState({ mode: 'maritime' })
    expect(useHud.getState().hidden).toBe(true)
  })

  it('does nothing once unbound', () => {
    showHudOnModalOpen()()
    useHud.getState().hide()
    useMode.getState().toggleHelp()
    expect(useHud.getState().hidden).toBe(true)
  })
})
