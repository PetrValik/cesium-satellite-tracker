/**
 * Compact-HUD sheet rules (the store itself is core/ui/sheetStore): the DOM
 * ids the dock buttons and the chip point at, which sheet can actually
 * render, and how selection changes open / close them.
 */
import { useMode } from '../core/ui/modeStore'
import { useSheet, type HudSheet } from '../core/ui/sheetStore'
import { hasSelectionInMode, subscribeSelectionChanges } from './selectionMode'

/** DOM id of a sheet — the target of its opener's aria-controls (focus return keys off it). */
export function sheetId(sheet: HudSheet): string {
  return `hud-sheet-${sheet}`
}

/**
 * The sheet that can render: `picture` needs the focused domain's picture
 * (its layer on), `details` needs a selection in the focused mode. A sheet
 * with nothing to show is closed (null).
 */
export function visibleSheet(
  sheet: HudSheet | null,
  hasPicture: boolean,
  hasSelection: boolean,
): HudSheet | null {
  if (sheet === 'picture' && !hasPicture) return null
  if (sheet === 'details' && !hasSelection) return null
  return sheet
}

/**
 * Selection drives the sheets: a fresh pick closes the picture / layers
 * sheet so the globe and the chip are visible; losing the focused mode's
 * selection (deselect, or a mode switch) closes details, which would
 * otherwise reopen on the next pick. Returns the unsubscribe; CompactHud
 * binds it while the compact layout is mounted.
 */
export function bindSheetsToSelection(): () => void {
  const sync = (picked: boolean) => {
    const sheets = useSheet.getState()
    if (picked) {
      sheets.closeIf('picture')
      sheets.closeIf('layers')
    }
    if (!hasSelectionInMode()) sheets.closeIf('details')
  }
  const offSelection = subscribeSelectionChanges((_mode, selected) => sync(selected))
  const offMode = useMode.subscribe((s, p) => {
    if (s.mode !== p.mode) sync(false)
  })
  return () => {
    offSelection()
    offMode()
  }
}
