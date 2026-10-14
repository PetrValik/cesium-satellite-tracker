import { useEffect } from 'react'
import { handleHudKey } from './hudStore'

/**
 * Binds the HUD hide/show keys (hudStore.handleHudKey) for the session.
 * Capture phase on window runs before GlobeView's bubble-phase keydown
 * handler, so a consumed Escape is stopped before it can release the follow
 * lock or deselect — GlobeView needs no knowledge of the hidden HUD.
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
