import { flushSync } from 'react-dom'
import { useHud } from '../core/ui/hudStore'

const HIDE_ID = 'hud-hide-controls'
const SHOW_ID = 'hud-show-controls'

/**
 * Focus handoff between the two toggles: whichever one was activated
 * disappears (the HUD goes inert / the restore button unmounts), so a
 * keyboard user lands on its counterpart instead of <body>. Only when the
 * activated button actually held focus — the U / Escape keys leave focus alone.
 */
function swapFocus(from: HTMLElement, apply: () => void, toId: string): void {
  const hadFocus = document.activeElement === from
  flushSync(apply)
  if (hadFocus) document.getElementById(toId)?.focus()
}

/** HIDE: in the desktop launcher row (U) and the compact dock. */
export function HideControlsButton() {
  const hidden = useHud((s) => s.hidden)
  return (
    <button
      id={HIDE_ID}
      className="hud-button hide-button"
      aria-pressed={hidden}
      aria-label="Hide controls"
      title="Hide controls (U)"
      onClick={(e) => swapFocus(e.currentTarget, useHud.getState().hide, SHOW_ID)}
    >
      HIDE
    </button>
  )
}

/** The one control left while the HUD is hidden (App mounts it outside the inert layer). */
export function ShowControlsButton() {
  return (
    <button
      id={SHOW_ID}
      className="hud-restore"
      aria-label="Show controls"
      title="Show controls (U)"
      onClick={(e) => swapFocus(e.currentTarget, useHud.getState().show, HIDE_ID)}
    >
      <span className="hud-panel hud-restore-bezel" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
          <path d="M1.5 10C4 5.6 6.8 4 10 4s6 1.6 8.5 6c-2.5 4.4-5.3 6-8.5 6s-6-1.6-8.5-6Z" />
          <circle cx="10" cy="10" r="2.6" />
        </svg>
      </span>
    </button>
  )
}
