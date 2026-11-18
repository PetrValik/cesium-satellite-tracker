/**
 * Curated palette: 8 hue columns × 4 shade rows, row-major, so every row
 * holds one shade of each family and every column runs light → base →
 * deep → dim (strictly falling luminance; swatches.test.ts holds that).
 * Columns follow the colour wheel — RED, PINK, VIOLET, BLUE, ICE→TEAL,
 * LIME→GREEN, GOLD, GREY — with neighbouring hues merged into one column so
 * that eight ≥ 32 px swatches fit the picker well on a 360 px phone
 * (styles/colors.css lays out the same `repeat(8, …)`). Every prefsStore
 * DEFAULT_COLORS value sits in the BASE row or, for the satellite orbit
 * classes, the LIGHT row, so any default is one click away; the trailing
 * comment names its palette-v2 meaning. Deliberately absent: the selection
 * amber #ffb454 (SIGNAL_AMBER marks the selected object only) and white
 * (vanishes over the light `streets` basemap). Every shade keeps WCAG
 * luminance ≥ 0.12, about 3:1 on the picker well. Data, not view: hex lives
 * here, not in TSX.
 */
export const SWATCH_COLUMNS = 8
export const SWATCH_ROWS = 4

export const SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  // LIGHT
  { hex: '#ffa894', name: 'CORAL' },
  { hex: '#ffa1b5', name: 'PINK' }, // default: HEO satellites
  { hex: '#dcbcff', name: 'LILAC' },
  { hex: '#a3d0ff', name: 'SKY' },
  { hex: '#a8f0ff', name: 'ICE' }, // default: LEO satellites
  { hex: '#a3e635', name: 'LIME' }, // default: MEO satellites
  { hex: '#ffe7a3', name: 'PALE GOLD' },
  { hex: '#c7d0dc', name: 'SILVER' },
  // BASE
  { hex: '#f87171', name: 'RED' }, // default: military aircraft and ships
  { hex: '#ff5f8f', name: 'HOT PINK' }, // default: high-speed craft
  { hex: '#c084fc', name: 'VIOLET' }, // default: tankers
  { hex: '#4da6ff', name: 'BLUE' }, // default: civil aircraft, passenger ships
  { hex: '#2dd4bf', name: 'TEAL' }, // default: fishing
  { hex: '#7dd87d', name: 'GREEN' }, // default: cargo aircraft and ships
  { hex: '#ffd166', name: 'GOLD' }, // default: GEO satellites
  { hex: '#8a93a3', name: 'GREY' }, // default: other ships (= SIGNAL_GROUND)
  // DEEP
  { hex: '#dc4c4c', name: 'DEEP RED' },
  { hex: '#d6408a', name: 'DEEP PINK' },
  { hex: '#9d62e8', name: 'DEEP VIOLET' },
  { hex: '#2f7fe0', name: 'DEEP BLUE' },
  { hex: '#14a899', name: 'DEEP TEAL' },
  { hex: '#3fae5a', name: 'DEEP GREEN' },
  { hex: '#e0b030', name: 'DEEP GOLD' },
  { hex: '#6a7a92', name: 'SLATE' },
  // DIM
  { hex: '#a84444', name: 'DIM RED' },
  { hex: '#a3416a', name: 'DIM PINK' },
  { hex: '#7a52b3', name: 'DIM VIOLET' },
  { hex: '#3b64a8', name: 'DIM BLUE' },
  { hex: '#2b7d76', name: 'DIM TEAL' },
  { hex: '#4e8f4e', name: 'DIM GREEN' },
  { hex: '#a8862a', name: 'DIM GOLD' },
  { hex: '#5e6470', name: 'DIM GREY' },
]

/**
 * The hex field's rule: `#RRGGBB` or bare `RRGGBB` (either case, trimmed)
 * becomes lower-case `#rrggbb`, matching DEFAULT_COLORS and the stored
 * prefs; anything else is null and the field reverts to the stored value.
 */
export function parseHexInput(text: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim())
  return match ? `#${match[1].toLowerCase()}` : null
}
