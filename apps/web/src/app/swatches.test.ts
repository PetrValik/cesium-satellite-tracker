import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SIGNAL_AMBER } from '../core/engine/signalColors'
import { parseHexInput, SWATCH_COLUMNS, SWATCH_ROWS, SWATCHES } from './swatches'
import { DEFAULT_COLORS } from '../core/ui/prefsStore'

// read from disk: vitest serves CSS as an empty module (see core/engine/signalColors.test.ts)
const colorsCss = readFileSync(new URL('../styles/colors.css', import.meta.url), 'utf8')
/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const at = (row: number, col: number) => SWATCHES[row * SWATCH_COLUMNS + col]

describe('SWATCHES', () => {
  it('offers every default colour, so any default is one click away', () => {
    const offered = new Set(SWATCHES.map((s) => s.hex))
    const defaults = Object.values(DEFAULT_COLORS).flatMap((domain: Record<string, string>) => Object.values(domain))
    for (const hex of defaults) expect(offered, hex).toContain(hex)
  })

  it('is a full grid of at most 8 hue columns by 4 shade rows', () => {
    expect(SWATCH_COLUMNS).toBeLessThanOrEqual(8)
    expect(SWATCH_ROWS).toBe(4)
    expect(SWATCHES).toHaveLength(SWATCH_COLUMNS * SWATCH_ROWS)
  })
  it('holds unique lower-case #rrggbb values with unique upper-case names', () => {
    for (const s of SWATCHES) { expect(s.hex).toMatch(/^#[0-9a-f]{6}$/); expect(s.name).toMatch(/^[A-Z][A-Z ]*$/) }
    expect(new Set(SWATCHES.map((s) => s.hex)).size).toBe(SWATCHES.length)
    expect(new Set(SWATCHES.map((s) => s.name)).size).toBe(SWATCHES.length)
  })
  it('runs every column light -> base -> deep -> dim', () => {
    for (let col = 0; col < SWATCH_COLUMNS; col++)
      for (let row = 1; row < SWATCH_ROWS; row++)
        expect(luminance(at(row, col).hex), at(row, col).name).toBeLessThan(luminance(at(row - 1, col).hex))
  })
  it('keeps every swatch visible on the picker well (luminance >= 0.12, about 3:1 on #131820)', () => {
    for (const s of SWATCHES) expect(luminance(s.hex), s.name).toBeGreaterThanOrEqual(0.12)
  })
  it('never offers the selection amber', () => {
    expect(SWATCHES.map((s) => s.hex)).not.toContain(SIGNAL_AMBER)
  })
  it('matches the column count styles/colors.css lays out', () => {
    expect(colorsCss).toMatch(new RegExp(`grid-template-columns:\\s*repeat\\(${SWATCH_COLUMNS},`))
  })
})

describe('parseHexInput', () => {
  it('accepts #RRGGBB and bare RRGGBB, trimmed, as lower-case #rrggbb', () => {
    expect(parseHexInput('#4DA6FF')).toBe('#4da6ff')
    expect(parseHexInput('4da6ff')).toBe('#4da6ff')
    expect(parseHexInput('  #2DD4BF ')).toBe('#2dd4bf')
  })
  it('rejects anything else', () => {
    for (const bad of ['', '#', '#fff', 'fff', '#12345g', '##4da6ff', '#4da6ff0', 'rgb(1,2,3)'])
      expect(parseHexInput(bad), bad).toBeNull()
  })
})
