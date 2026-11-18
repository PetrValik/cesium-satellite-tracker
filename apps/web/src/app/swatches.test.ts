import { describe, expect, it } from 'vitest'
import { DEFAULT_COLORS } from '../core/ui/prefsStore'
import { SWATCHES, parseHexInput } from './swatches'

describe('SWATCHES', () => {
  it('offers every default colour, so any default is one click away', () => {
    const offered = new Set(SWATCHES.map((s) => s.hex))
    const defaults = Object.values(DEFAULT_COLORS).flatMap((domain: Record<string, string>) => Object.values(domain))
    for (const hex of defaults) expect(offered, hex).toContain(hex)
  })

  it('holds unique lower-case #rrggbb values, six per row', () => {
    for (const s of SWATCHES) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(SWATCHES.map((s) => s.hex)).size).toBe(SWATCHES.length)
    expect(SWATCHES.length % 6).toBe(0)
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
