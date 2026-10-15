/**
 * Curated palette: six family columns (amber, cyan, green, red, violet/blue,
 * neutral), four shades per column running bright → dim down the grid.
 * Row-major order, so every row holds one shade of each family. Chosen for
 * legibility against the near-black globe, and every prefsStore
 * DEFAULT_COLORS value appears here so any default is one click away
 * (swatches.test.ts holds that). Data, not view: hex lives here, not in TSX.
 */
export const SWATCHES: ReadonlyArray<{ hex: string; name: string }> = [
  // brightest shades
  { hex: '#ffd166', name: 'GOLD' },
  { hex: '#a8f0ff', name: 'ICE' },
  { hex: '#a3e635', name: 'LIME' },
  { hex: '#ffa1b5', name: 'PINK' },
  { hex: '#c084fc', name: 'VIOLET' }, // default: GEO, passenger ships
  { hex: '#f0f4f8', name: 'WHITE' }, // default: highspeed ships
  // the app's base hues (matches DEFAULT_COLORS)
  { hex: '#ffb454', name: 'AMBER' }, // default: LEO, tanker ships
  { hex: '#6ee7ff', name: 'CYAN' }, // default: MEO, cargo ships
  { hex: '#7dd87d', name: 'GREEN' }, // default: military aircraft, fishing
  { hex: '#ff5f8f', name: 'HOT PINK' },
  { hex: '#4da6ff', name: 'BLUE' }, // default: civil aircraft
  { hex: '#c7d0dc', name: 'SILVER' },
  // saturated alternates
  { hex: '#ff8f3d', name: 'ORANGE' },
  { hex: '#2dd4bf', name: 'TEAL' },
  { hex: '#34d399', name: 'EMERALD' },
  { hex: '#f87171', name: 'RED' }, // default: HEO, military ships, cargo aircraft
  { hex: '#8b5cf6', name: 'IRIS' },
  { hex: '#8a93a3', name: 'GREY' }, // default: other ships
  // dimmed shades for subdued layers
  { hex: '#c27a2e', name: 'DIM AMBER' },
  { hex: '#3a9daf', name: 'DIM CYAN' },
  { hex: '#4e8f4e', name: 'DIM GREEN' },
  { hex: '#b04a4a', name: 'DIM RED' },
  { hex: '#3b6fd4', name: 'DIM BLUE' },
  { hex: '#5c6674', name: 'DIM GREY' },
]
