import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStored, writeStored } from './storage'

/** Minimal in-memory localStorage shim (tests run in plain node — no jsdom). */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const backing = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => void backing.set(key, String(value)),
  })
  return backing
}

function stubBrokenStorage(): void {
  const fail = () => {
    throw new Error('SecurityError: storage blocked')
  }
  vi.stubGlobal('localStorage', { getItem: fail, setItem: fail })
}

const asObject = (value: unknown) => value as { n: number }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readStored', () => {
  it('returns the parsed value run through parse', () => {
    stubStorage({ k: JSON.stringify({ n: 7 }) })
    expect(readStored('k', (v) => asObject(v).n * 2)).toBe(14)
  })

  it('is undefined when nothing is stored', () => {
    stubStorage()
    const parse = vi.fn()
    expect(readStored('k', parse)).toBeUndefined()
    expect(parse).not.toHaveBeenCalled()
  })

  it('is undefined on corrupt JSON', () => {
    stubStorage({ k: '{not json' })
    expect(readStored('k', asObject)).toBeUndefined()
  })

  it('is undefined when parse throws (e.g. a stored null)', () => {
    stubStorage({ k: 'null' })
    expect(readStored('k', (v) => asObject(v).n)).toBeUndefined()
  })

  it('is undefined when storage itself throws', () => {
    stubBrokenStorage()
    expect(readStored('k', asObject)).toBeUndefined()
  })
})

describe('writeStored', () => {
  it('stores the value as JSON', () => {
    const backing = stubStorage()
    writeStored('k', { n: 1 })
    expect(backing.get('k')).toBe('{"n":1}')
  })

  it('swallows a storage failure (the app keeps working in-memory)', () => {
    stubBrokenStorage()
    expect(() => writeStored('k', { n: 1 })).not.toThrow()
  })
})
