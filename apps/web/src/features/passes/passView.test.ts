import { describe, expect, it } from 'vitest'
import type { PassPrediction } from '../../lib/protocol'
import { passView } from './passView'

const p = (aosMs: number, losMs: number): PassPrediction => ({ noradId: 1, aosMs, losMs, maxElDeg: 40,
  maxElMs: (aosMs + losMs) / 2, samples: [], riseAzDeg: 270, setAzDeg: 90, nakedEye: false })
const PASSES = [p(1_000_000, 1_600_000), p(10_000_000, 10_500_000), p(20_000_000, 20_400_000)]

describe('passView', () => {
  it('counts down to the next pass in rounded-up minutes', () => {
    expect(passView(PASSES, null, 0)).toEqual({ nextIndex: 0, shownIndex: 0, countdown: 'IN 17 MIN' })
    expect(passView(PASSES, null, 2_000_000)).toEqual({ nextIndex: 1, shownIndex: 1, countdown: 'IN 2 H 14' })
  })
  it('reads NOW · ENDS IN during a pass, up to and including LOS', () => {
    expect(passView(PASSES, null, 1_200_000).countdown).toBe('NOW · ENDS IN 7 MIN')
    expect(passView(PASSES, null, 1_600_000)).toEqual({ nextIndex: 0, shownIndex: 0, countdown: 'NOW · ENDS IN 1 MIN' })
  })
  it('shows a picked pass until it ends, then falls back to the next', () => {
    expect(passView(PASSES, 2, 2_000_000).shownIndex).toBe(2)
    expect(passView(PASSES, 0, 2_000_000).shownIndex).toBe(1)
    expect(passView(PASSES, 7, 2_000_000).shownIndex).toBe(1)
  })
  it('has no next pass once the window is spent, or with no passes', () => {
    expect(passView(PASSES, null, 30_000_000)).toEqual({ nextIndex: -1, shownIndex: -1, countdown: null })
    expect(passView([], null, 0)).toEqual({ nextIndex: -1, shownIndex: -1, countdown: null })
  })
})
