import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObserverGeo, PassPrediction } from '../../lib/protocol'

const STORAGE_KEY = 'orbital-ops.observer'
const PRAGUE: ObserverGeo = { latDeg: 50.08, lonDeg: 14.44, heightM: 200 }

const pass = (noradId: number): PassPrediction => ({
  noradId,
  aosMs: 1_000,
  losMs: 2_000,
  maxElDeg: 45,
  maxElMs: 1_500,
  samples: [],
})

/** Minimal in-memory localStorage shim (tests run in plain node — no jsdom). */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const backing = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => backing.clear(),
  })
  return backing
}

/** Fresh store module against the given storage contents (loadObserver runs at import). */
async function loadStore(initial?: Record<string, string>) {
  const backing = stubStorage(initial)
  vi.resetModules()
  const { usePasses } = await import('./passesStore')
  return { usePasses, backing }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('passesStore loadObserver', () => {
  it('defaults to Prague when storage is empty', async () => {
    const { usePasses } = await loadStore()
    expect(usePasses.getState().observer).toEqual(PRAGUE)
  })

  it('restores a valid stored observer', async () => {
    const stored: ObserverGeo = { latDeg: 10.5, lonDeg: -20.25, heightM: 5 }
    const { usePasses } = await loadStore({ [STORAGE_KEY]: JSON.stringify(stored) })
    expect(usePasses.getState().observer).toEqual(stored)
  })

  it('rejects out-of-range or corrupted values, falling back to Prague', async () => {
    const badLat = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ latDeg: 95, lonDeg: 0, heightM: 0 }),
    })
    expect(badLat.usePasses.getState().observer).toEqual(PRAGUE)

    const badLon = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ latDeg: 0, lonDeg: 181, heightM: 0 }),
    })
    expect(badLon.usePasses.getState().observer).toEqual(PRAGUE)

    const corrupted = await loadStore({ [STORAGE_KEY]: '{not json' })
    expect(corrupted.usePasses.getState().observer).toEqual(PRAGUE)
  })
})

describe('passesStore setObserver', () => {
  it('resets computed passes and persists the new observer', async () => {
    const { usePasses, backing } = await loadStore()
    usePasses.getState().startCompute(25544)
    usePasses.getState().setResults(25544, [pass(25544)], 111)
    usePasses.getState().selectPass(0)
    expect(usePasses.getState().passes).toHaveLength(1)

    const next: ObserverGeo = { latDeg: 1, lonDeg: 2, heightM: 3 }
    usePasses.getState().setObserver(next)

    const s = usePasses.getState()
    expect(s.observer).toEqual(next)
    expect(s.passes).toEqual([])
    expect(s.computedFor).toBeNull()
    expect(s.windowStartMs).toBeNull()
    expect(s.selectedPass).toBeNull()
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toEqual(next)
  })
})

describe('passesStore setResults', () => {
  it('drops results whose noradId no longer matches computedFor', async () => {
    const { usePasses } = await loadStore()
    usePasses.getState().startCompute(1)
    usePasses.getState().startCompute(2) // selection moved on before results landed

    usePasses.getState().setResults(1, [pass(1)], 50)
    let s = usePasses.getState()
    expect(s.passes).toEqual([])
    expect(s.windowStartMs).toBeNull()
    expect(s.computing).toBe(true) // still waiting on the current computation

    usePasses.getState().setResults(2, [pass(2)], 60)
    s = usePasses.getState()
    expect(s.passes).toHaveLength(1)
    expect(s.passes[0]!.noradId).toBe(2)
    expect(s.windowStartMs).toBe(60)
    expect(s.computing).toBe(false)
  })
})
