import { useEffect } from 'react'
import { handleHudKey } from './hudStore'

/**
 * Binds the HUD hide/show keys (hudStore.handleHudKey) for the session.
 * Capture phase on window runs before the globe's bubble-phase keydown
 * handler (app/globe/globeKeys.ts `bindGlobeKeys`), so a consumed Escape is
 * stopped before it can release the follow lock or deselect. The two
 * handlers depend on that order. globeKeys still reads `useHud.hidden`
 * itself (`timeControlsActive`): its transport keys go quiet while the HUD
 * is hidden.
 */
export function useHudShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!handleHudKey(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
