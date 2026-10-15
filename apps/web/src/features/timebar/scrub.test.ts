import { describe, expect, it } from 'vitest'
import { SCRUB_RANGE_MIN, scrubOffsetMin, scrubSliderValue } from './scrub'

describe('scrubOffsetMin', () => {
  it('rounds the sim↔wall gap to whole minutes, signed', () => {
    const now = 1_800_000_000_000
    expect(scrubOffsetMin(now, now)).toBe(0)
    expect(scrubOffsetMin(now + 90 * 60_000 + 29_000, now)).toBe(90)
    expect(scrubOffsetMin(now - 45 * 60_000, now)).toBe(-45)
  })
})

describe('scrubSliderValue', () => {
  it('follows the drag while one is in progress', () => {
    expect(scrubSliderValue(-120, 300)).toBe(-120)
  })

  it('otherwise shows the sim offset', () => {
    expect(scrubSliderValue(0, 37)).toBe(37)
  })

  it('pins an offset beyond the range to the slider ends', () => {
    expect(scrubSliderValue(0, SCRUB_RANGE_MIN + 500)).toBe(SCRUB_RANGE_MIN)
    expect(scrubSliderValue(0, -SCRUB_RANGE_MIN - 1)).toBe(-SCRUB_RANGE_MIN)
  })
})
