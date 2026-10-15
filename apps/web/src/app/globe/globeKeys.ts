import { CameraRig } from '../../core/engine/CameraRig'
import { simClock, stepRate } from '../../core/sim/simClock'
import { useFollow } from '../../core/ui/followStore'
import { useHud } from '../../core/ui/hudStore'
import { isTypingTarget } from '../../core/ui/keyboard'
import { transportVisible, useMode } from '../../core/ui/modeStore'
import { useSheet } from '../../core/ui/sheetStore'
import { deselectInMode, hasSelectionInMode } from '../selectionMode'

/** The rig surface the keys drive — structural, so tests pass a fake. */
type KeyRig = Pick<CameraRig, 'press' | 'release' | 'releaseAll'>

/** The KeyboardEvent fields the handlers read (plain objects in tests). */
export type GlobeKeyEvent = Pick<
  KeyboardEvent,
  'code' | 'key' | 'target' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'preventDefault'
>

/**
 * The time controls travel with the transport bar: hidden with the ORBITAL
 * layer (the bar is unmounted then, transportVisible) and with the HUD
 * (the bar is faded out and inert). The keyboard equivalents go quiet with
 * it, or an invisible warp would silently suspend the live feeds.
 */
export function timeControlsActive(): boolean {
  return transportVisible(useMode.getState()) && !useHud.getState().hidden
}

/** Step the sim rate one SIM_RATES notch; nothing past either end. */
function stepClockRate(direction: 1 | -1): void {
  const clock = simClock.get()
  const next = stepRate(clock.rate, direction)
  if (next !== undefined) clock.setRate(next)
}

/**
 * The globe's keyboard: held camera-movement keys go to the rig, the rest
 * are the global shortcuts (docs/CONTROLS.md). Bubble phase on window, so
 * the HUD toggle (capture phase, core/ui/useHudShortcuts) and an open
 * sheet's own Escape (core/ui/sheetStore) see a key first.
 */
export function globeKeyHandlers(rig: KeyRig) {
  const onKeyDown = (e: GlobeKeyEvent): void => {
    if (isTypingTarget(e.target)) return
    if (CameraRig.isMovementKey(e.code)) {
      rig.press(e.code)
      e.preventDefault()
      return
    }
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
    switch (e.code) {
      case 'KeyF':
        if (hasSelectionInMode()) useFollow.getState().toggle()
        break
      case 'Escape':
        // Innermost first, one layer per press: overlays, then an open
        // compact sheet (closing it does nothing else), then the follow
        // lock, then the selection.
        if (useMode.getState().helpOpen) useMode.getState().closeHelp()
        else if (useMode.getState().settingsOpen) useMode.getState().closeSettings()
        else if (useSheet.getState().sheet !== null) useSheet.getState().close()
        else if (useFollow.getState().following) useFollow.getState().setFollowing(false)
        else deselectInMode()
        break
      case 'Digit1':
        useMode.getState().toggleDomain('orbital')
        break
      case 'Digit2':
        useMode.getState().toggleDomain('maritime')
        break
      case 'Digit3':
        useMode.getState().toggleDomain('airspace')
        break
      case 'Space':
        if (timeControlsActive()) {
          simClock.get().togglePlay()
          e.preventDefault()
        }
        break
      case 'KeyN':
        if (timeControlsActive()) simClock.get().resetToNow()
        break
      case 'Comma':
        if (timeControlsActive()) stepClockRate(-1)
        break
      case 'Period':
        if (timeControlsActive()) stepClockRate(1)
        break
      case 'KeyH':
        useMode.getState().toggleHelp()
        break
      default:
        if (e.key === '?') useMode.getState().toggleHelp()
    }
  }
  const onKeyUp = (e: Pick<KeyboardEvent, 'code'>): void => {
    if (CameraRig.isMovementKey(e.code)) rig.release(e.code)
  }
  const onBlur = (): void => rig.releaseAll()
  return { onKeyDown, onKeyUp, onBlur }
}

/** Bind the globe keyboard to `window`; returns the exact unbind. */
export function bindGlobeKeys(rig: KeyRig): () => void {
  const { onKeyDown, onKeyUp, onBlur } = globeKeyHandlers(rig)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
