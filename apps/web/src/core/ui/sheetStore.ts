import type { KeyboardEvent } from 'react'
import { create } from 'zustand'
import { useMode } from './modeStore'

/**
 * Compact (phone) HUD sheets. The desktop side panels become sheets that
 * open above the dock, one at a time:
 * - `picture` — the focused mode's left-rail content (catalog / vessel / air picture)
 * - `layers`  — the LAYERS toggles
 * - `details` — the selection panels the desktop shows in the right stack
 * Not persisted: a reload always opens on the bare globe.
 */
export type HudSheet = 'picture' | 'layers' | 'details'

export interface SheetState {
  sheet: HudSheet | null
  /** Open `sheet`, or close it when it is already the open one. */
  toggle: (sheet: HudSheet) => void
  close: () => void
  /** Close only if `sheet` is the open one (selection-driven auto-close). */
  closeIf: (sheet: HudSheet) => void
}

export const useSheet = create<SheetState>((set) => ({
  sheet: null,
  toggle: (sheet) => set((s) => ({ sheet: s.sheet === sheet ? null : sheet })),
  close: () => set({ sheet: null }),
  closeIf: (sheet) => set((s) => (s.sheet === sheet ? { sheet: null } : s)),
}))

/** Sheet onKeyDown: Escape closes the sheet only — stopped here, it never reaches GlobeView's window handler (which would deselect). */
export function closeSheetOnEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  useSheet.getState().close()
}

/**
 * HELP and COLORS are modal: opening either closes the open sheet, so it
 * neither sits under the dialog nor resurfaces when the dialog closes.
 * Watches the modal flags rather than the buttons, so the H / ? keys count
 * too. Returns the unsubscribe; App binds it once for the session.
 */
export function closeSheetOnModalOpen(): () => void {
  return useMode.subscribe((s, p) => {
    const opened = (s.helpOpen && !p.helpOpen) || (s.settingsOpen && !p.settingsOpen)
    if (opened) useSheet.getState().close()
  })
}
