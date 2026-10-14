import { useSyncExternalStore } from 'react'

/**
 * The phone HUD breakpoint. Narrow screens, plus touch landscape phones that
 * are wider than 899px but too short for the side panels (e.g. 932x430).
 * App swaps the desktop instrument clusters for the dock + sheets layout
 * when this matches, and sets `.is-compact` on `.app-root` so the CSS keys
 * off the same decision — never a second, drifting media query.
 */
export const COMPACT_QUERY = '(max-width: 899px), (max-height: 520px) and (pointer: coarse)'

let mql: MediaQueryList | null = null

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  mql ??= window.matchMedia(COMPACT_QUERY)
  return mql
}

function subscribe(onChange: () => void): () => void {
  const q = query()
  if (!q) return () => {}
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean => query()?.matches ?? false

/** True while the compact (phone) HUD layout is active; re-renders on change. */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
