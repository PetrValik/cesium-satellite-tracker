import { beforeEach, describe, expect, it } from 'vitest'
import type { Satellite } from '@orbital-ops/shared'
import { useMode } from '../../core/ui/modeStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import { pickSearchResult } from './searchPick'

const ISS: Satellite = {
  noradId: 25_544, name: 'ISS (ZARYA)',
  tle1: '1'.padEnd(69, 'x'), tle2: '2'.padEnd(69, 'x'), groups: [],
}

beforeEach(() => {
  // CATALOG stacked under a focused MARITIME: the case a select-only pick got wrong
  useMode.setState({ mode: 'maritime', satellitesVisible: true, shipsVisible: true })
  useSatellites.setState({ byId: new Map(), selectedId: null })
})

describe('pickSearchResult', () => {
  it('focuses ORBITAL and selects the hit', () => {
    pickSearchResult(ISS)
    expect(useMode.getState().mode).toBe('orbital')
    expect(useSatellites.getState().selectedId).toBe(25_544)
  })

  it('registers and focuses before it selects, like a globe tap', () => {
    let atSelect: { mode: string; known: boolean } | null = null
    const off = useSatellites.subscribe((s, p) => {
      if (s.selectedId !== p.selectedId)
        atSelect = { mode: useMode.getState().mode, known: s.byId.has(25_544) }
    })
    pickSearchResult(ISS)
    off()
    expect(atSelect).toEqual({ mode: 'orbital', known: true })
  })
})
