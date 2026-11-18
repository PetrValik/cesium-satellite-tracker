import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'orbital-ops.legend-folds'
const UNFOLDED = { orbital: false, maritime: false, airspace: false }

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

async function loadStore(initial?: Record<string, string>) {
  const backing = stubStorage(initial)
  vi.resetModules()
  const { useLegendFolds } = await import('./legendFoldStore')
  return { useLegendFolds, backing }
}

afterEach(() => vi.unstubAllGlobals())

describe('legendFoldStore load', () => {
  it('starts with every section unfolded', async () => {
    const { useLegendFolds } = await loadStore()
    expect(useLegendFolds.getState().folded).toEqual(UNFOLDED)
  })
  it('restores the stored folds', async () => {
    const { useLegendFolds } = await loadStore({ [KEY]: JSON.stringify({ orbital: true }) })
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, orbital: true })
  })
  it('reads anything but true as unfolded and keeps only the three domains', async () => {
    const raw = JSON.stringify({ orbital: 'yes', maritime: 1, airspace: true, sun: true })
    const { useLegendFolds } = await loadStore({ [KEY]: raw })
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, airspace: true })
  })
  it.each(['null', '[]', '"folded"', '{not json'])('falls back to unfolded on %s', async (raw) => {
    const { useLegendFolds } = await loadStore({ [KEY]: raw })
    expect(useLegendFolds.getState().folded).toEqual(UNFOLDED)
  })
})

describe('toggleFold', () => {
  it('flips one domain and persists all three', async () => {
    const { useLegendFolds, backing } = await loadStore()
    useLegendFolds.getState().toggleFold('maritime')
    expect(useLegendFolds.getState().folded).toEqual({ ...UNFOLDED, maritime: true })
    expect(JSON.parse(backing.get(KEY) ?? 'null')).toEqual({ ...UNFOLDED, maritime: true })
    useLegendFolds.getState().toggleFold('maritime')
    expect(JSON.parse(backing.get(KEY) ?? 'null')).toEqual(UNFOLDED)
  })
})
