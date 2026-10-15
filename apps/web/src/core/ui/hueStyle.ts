import type { CSSProperties } from 'react'

/**
 * Inline style carrying one user-palette colour (core/ui/prefsStore — the
 * colours the globe paints with) as the `--hue` custom property. Legend
 * swatches and labels (styles/rail.css `.has-hue`, `.hue-text`) and the
 * telemetry orbit-class badge (styles/telemetry.css `.orbit-class`) colour
 * themselves from `var(--hue)`, so a panel can never drift from the globe
 * or from a recolour.
 */
export function hueStyle(color: string): CSSProperties {
  return { '--hue': color } as CSSProperties
}
