import { describe, expect, it } from 'vitest'
import { MID_COUNTRIES, flagEmojiOf, flagStateOf } from './mmsiFlags'

describe('mmsiFlags', () => {
  it('flagStateOf resolves the MID prefix to the display name', () => {
    expect(flagStateOf(247_123_456)).toBe('Italy')
    expect(flagStateOf(211_000_001)).toBe('Germany')
    expect(flagStateOf(351_999_999)).toBe('Panama')
    expect(flagStateOf(232_000_000)).toBe('UK')
  })

  it('flagStateOf returns null for unknown prefixes', () => {
    expect(flagStateOf(999_123_456)).toBeNull()
    expect(flagStateOf(100_000_000)).toBeNull()
  })

  it('flagEmojiOf builds the regional-indicator pair', () => {
    expect(flagEmojiOf(247_123_456)).toBe('🇮🇹')
    expect(flagEmojiOf(211_000_001)).toBe('🇩🇪')
    expect(flagEmojiOf(338_000_000)).toBe('🇺🇸')
  })

  it('flagEmojiOf returns null for unknown prefixes', () => {
    expect(flagEmojiOf(999_123_456)).toBeNull()
  })

  it('every table entry has a valid two-letter uppercase ISO code', () => {
    for (const [mid, [name, iso2]] of Object.entries(MID_COUNTRIES)) {
      expect(iso2, `MID ${mid} (${name})`).toMatch(/^[A-Z]{2}$/)
    }
  })
})
