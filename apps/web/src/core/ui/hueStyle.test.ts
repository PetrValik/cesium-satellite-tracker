import { describe, expect, it } from 'vitest'
import { hueStyle } from './hueStyle'

describe('hueStyle', () => {
  it('carries the colour as the --hue custom property only', () => {
    expect(hueStyle('#4da6ff')).toEqual({ '--hue': '#4da6ff' })
  })
})
