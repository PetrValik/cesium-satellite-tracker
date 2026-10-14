import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useMode } from './modeStore'
import { closeSheetOnModalOpen, useSheet } from './sheetStore'

let unbind: (() => void) | null = null

beforeEach(() => {
  useSheet.setState({ sheet: null })
  useMode.setState({ helpOpen: false, settingsOpen: false })
})

afterEach(() => {
  unbind?.()
  unbind = null
})

describe('sheetStore', () => {
  it('opens one sheet at a time', () => {
    useSheet.getState().toggle('picture')
    expect(useSheet.getState().sheet).toBe('picture')
    useSheet.getState().toggle('layers')
    expect(useSheet.getState().sheet).toBe('layers')
  })

  it('toggling the open sheet closes it', () => {
    useSheet.getState().toggle('details')
    useSheet.getState().toggle('details')
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('closeIf leaves a different open sheet alone', () => {
    useSheet.getState().toggle('layers')
    useSheet.getState().closeIf('picture')
    expect(useSheet.getState().sheet).toBe('layers')
    useSheet.getState().closeIf('layers')
    expect(useSheet.getState().sheet).toBeNull()
  })
})

describe('closeSheetOnModalOpen', () => {
  it('opening HELP closes the open sheet, and closing HELP does not reopen it', () => {
    unbind = closeSheetOnModalOpen()
    useSheet.getState().toggle('layers')
    useMode.getState().toggleHelp()
    expect(useSheet.getState().sheet).toBeNull()
    useMode.getState().closeHelp()
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('opening COLORS closes the open sheet', () => {
    unbind = closeSheetOnModalOpen()
    useSheet.getState().toggle('details')
    useMode.getState().toggleSettings()
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('unrelated mode changes leave the sheet open', () => {
    unbind = closeSheetOnModalOpen()
    useSheet.getState().toggle('picture')
    useMode.setState({ mode: 'maritime' })
    useMode.getState().closeHelp()
    expect(useSheet.getState().sheet).toBe('picture')
  })

  it('does nothing once unbound', () => {
    closeSheetOnModalOpen()()
    useSheet.getState().toggle('layers')
    useMode.getState().toggleHelp()
    expect(useSheet.getState().sheet).toBe('layers')
  })
})
