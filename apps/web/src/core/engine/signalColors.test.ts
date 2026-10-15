import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIGNAL_AMBER, SIGNAL_CYAN } from './signalColors'

// Read from disk: vitest serves CSS (even `?raw`) as an empty module.
const tokensCss = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8')

/** The hex value of a `--name: #rrggbb;` declaration in tokens.css. */
function token(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(tokensCss)?.[1]?.toLowerCase()
}

describe('signalColors', () => {
  it('mirrors the tokens.css hues the HUD uses for the same signals', () => {
    expect(token('amber')).toBe(SIGNAL_AMBER)
    expect(token('cyan')).toBe(SIGNAL_CYAN)
  })
})
