import type { CSSProperties } from 'react'

/**
 * Inline style carrying one user-palette colour (core/ui/prefsStore — the
 * colours the globe paints with) as the `--hue` custom property. Legend
 * swatches and labels colour themselves from `var(--hue)` in index.css, so
 * a panel can never drift from the globe or from a recolour.
 */
export function hueStyle(color: string): CSSProperties {
  return { '--hue': color } as CSSProperties
}
