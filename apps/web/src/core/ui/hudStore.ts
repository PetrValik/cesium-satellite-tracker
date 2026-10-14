import { create } from 'zustand'
import { useMode } from './modeStore'
import { useSheet } from './sheetStore'

/**
 * "Clean globe": one session flag that hides the whole HUD (status line,
 * tabs, panels, dock, transport, chip, launchers). Only the restore button
 * and the Cesium credits stay on screen; the globe and the sim keep running.
 * Never persisted — a reload must always open with the controls showing.
 */
export interface HudState {
  hidden: boolean
  /** Hide the HUD; open sheets and the HELP / COLORS dialogs close with it. */
  hide: () => void
  show: () => void
  toggle: () => void
}

export const useHud = create<HudState>((set, get) => ({
  hidden: false,
  hide: () => {
    useSheet.getState().close()
    const mode = useMode.getState()
    if (mode.helpOpen) mode.closeHelp()
    if (mode.settingsOpen) mode.closeSettings()
    set({ hidden: true })
  },
  show: () => set({ hidden: false }),
  toggle: () => (get().hidden ? get().show() : get().hide()),
}))

/** The subset of KeyboardEvent the shortcut needs (plain objects in tests). */
export interface HudKeyEvent {
  code: string
  repeat: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/** Typing in a field (catalog search, observer coordinates) never toggles. */
function isTypingTarget(t: EventTarget | null): boolean {
  if (t === null || typeof t !== 'object') return false
  const el = t as Partial<HTMLElement>
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  )
}

/**
 * Keyboard map for the HUD toggle: `U` hides / shows; Escape while hidden
 * only shows. Returns true when the key was consumed — the caller must then
 * stop the event so GlobeView's Escape (follow release / deselect) never
 * sees it.
 */
export function handleHudKey(e: HudKeyEvent): boolean {
  if (isTypingTarget(e.target)) return false
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  const hud = useHud.getState()
  if (e.code === 'Escape' && hud.hidden) {
    hud.show()
    return true
  }
  if (e.code === 'KeyU' && !e.repeat) {
    hud.toggle()
    return true
  }
  return false
}

/**
 * HELP / COLORS can still be opened while hidden (the H / ? keys): a dialog
 * can't be served invisibly, so opening one brings the HUD back. Returns the
 * unsubscribe; App binds it once for the session.
 */
export function showHudOnModalOpen(): () => void {
  return useMode.subscribe((s, p) => {
    const opened = (s.helpOpen && !p.helpOpen) || (s.settingsOpen && !p.settingsOpen)
    if (opened && useHud.getState().hidden) useHud.getState().show()
  })
}
