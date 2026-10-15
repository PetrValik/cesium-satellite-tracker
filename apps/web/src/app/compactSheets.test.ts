import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The domain stores import lib/api; nothing here fetches.
vi.mock('../lib/api', () => ({ api: {}, ApiError: class extends Error {} }))

import { useMode } from '../core/ui/modeStore'
import { useSheet } from '../core/ui/sheetStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import { bindSheetsToSelection, sheetId, visibleSheet } from './compactSheets'

describe('sheetId', () => {
  it('is the id the openers point aria-controls at', () => {
    expect(sheetId('picture')).toBe('hud-sheet-picture')
    expect(sheetId('layers')).toBe('hud-sheet-layers')
    expect(sheetId('details')).toBe('hud-sheet-details')
  })
})

describe('visibleSheet', () => {
  it('closes the picture sheet while the focused domain has no picture', () => {
    expect(visibleSheet('picture', false, true)).toBeNull()
    expect(visibleSheet('picture', true, false)).toBe('picture')
  })

  it('closes the details sheet without a selection', () => {
    expect(visibleSheet('details', true, false)).toBeNull()
    expect(visibleSheet('details', false, true)).toBe('details')
  })

  it('always lets LAYERS render, and passes "none" through', () => {
    expect(visibleSheet('layers', false, false)).toBe('layers')
    expect(visibleSheet(null, true, true)).toBeNull()
  })
})

describe('bindSheetsToSelection', () => {
  let unbind: () => void

  beforeEach(() => {
    useMode.setState({ mode: 'orbital' })
    useCatalog.setState({ selectedId: null })
    useShips.setState({ selectedMmsi: null })
    useSheet.setState({ sheet: null })
    unbind = bindSheetsToSelection()
  })

  afterEach(() => unbind())

  it('a pick closes the picture and layers sheets', () => {
    useSheet.setState({ sheet: 'picture' })
    useCatalog.setState({ selectedId: 25_544 })
    expect(useSheet.getState().sheet).toBeNull()

    useSheet.setState({ sheet: 'layers' })
    useCatalog.setState({ selectedId: 43_013 })
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('a pick leaves the details sheet open', () => {
    useCatalog.setState({ selectedId: 25_544 })
    useSheet.setState({ sheet: 'details' })
    useCatalog.setState({ selectedId: 43_013 })
    expect(useSheet.getState().sheet).toBe('details')
  })

  it('losing the focused mode’s selection closes details', () => {
    useCatalog.setState({ selectedId: 25_544 })
    useSheet.setState({ sheet: 'details' })
    useCatalog.setState({ selectedId: null })
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('a background domain’s deselect keeps details open', () => {
    useCatalog.setState({ selectedId: 25_544 })
    useShips.setState({ selectedMmsi: 211_000_000 })
    useSheet.setState({ sheet: 'details' })
    useShips.setState({ selectedMmsi: null })
    expect(useSheet.getState().sheet).toBe('details')
  })

  it('switching to a mode with nothing selected closes details', () => {
    useCatalog.setState({ selectedId: 25_544 })
    useSheet.setState({ sheet: 'details' })
    useMode.setState({ mode: 'maritime' })
    expect(useSheet.getState().sheet).toBeNull()
  })

  it('stops reacting once unbound', () => {
    unbind()
    useSheet.setState({ sheet: 'picture' })
    useCatalog.setState({ selectedId: 25_544 })
    expect(useSheet.getState().sheet).toBe('picture')
    unbind = () => {}
  })
})
