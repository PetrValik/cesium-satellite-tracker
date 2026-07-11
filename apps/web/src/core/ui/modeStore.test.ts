import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'orbital-ops.mode'

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

/** Fresh store module against the given storage contents (load() runs at import). */
async function loadStore(initial?: Record<string, string>) {
  const backing = stubStorage(initial)
  vi.resetModules()
  const { useMode } = await import('./modeStore')
  return { useMode, backing }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('modeStore load', () => {
  it('defaults when storage is empty', async () => {
    const { useMode } = await loadStore()
    expect(useMode.getState()).toMatchObject({
      mode: 'orbital',
      launchSites: true,
      ports: false,
      shipsVisible: true,
      aircraftVisible: true,
      helpOpen: false,
    })
  })

  it('falls back to defaults on corrupted JSON', async () => {
    const { useMode } = await loadStore({ [STORAGE_KEY]: '{not json' })
    expect(useMode.getState()).toMatchObject({ mode: 'orbital', launchSites: true, ports: false })
  })

  it('rejects an unknown mode value but keeps the valid fields', async () => {
    const { useMode } = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ mode: 'sideways', ports: true }),
    })
    expect(useMode.getState().mode).toBe('orbital')
    expect(useMode.getState().ports).toBe(true)
  })

  it('hides live layers only on an explicit stored false', async () => {
    const explicit = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ mode: 'orbital', shipsVisible: false, aircraftVisible: false }),
    })
    expect(explicit.useMode.getState().shipsVisible).toBe(false)
    expect(explicit.useMode.getState().aircraftVisible).toBe(false)

    const missing = await loadStore({ [STORAGE_KEY]: JSON.stringify({ mode: 'maritime' }) })
    expect(missing.useMode.getState().shipsVisible).toBe(true)
    expect(missing.useMode.getState().aircraftVisible).toBe(true)

    const truthy = await loadStore({ [STORAGE_KEY]: JSON.stringify({ shipsVisible: 0 }) })
    expect(truthy.useMode.getState().shipsVisible).toBe(true)
  })
})

describe('modeStore persistence', () => {
  it('persists mode and infra toggles, surviving a reload', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().setMode('maritime')
    useMode.getState().toggleLaunchSites() // true -> false
    useMode.getState().togglePorts() // false -> true

    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toEqual({
      mode: 'maritime',
      launchSites: false,
      ports: true,
    })

    const reloaded = await loadStore({ [STORAGE_KEY]: backing.get(STORAGE_KEY)! })
    expect(reloaded.useMode.getState()).toMatchObject({
      mode: 'maritime',
      launchSites: false,
      ports: true,
    })
  })

  it('toggleShips flips in-memory state without breaking stored fields', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().toggleShips()
    expect(useMode.getState().shipsVisible).toBe(false)
    // NOTE: persist() only serializes mode/launchSites/ports today.
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toEqual({
      mode: 'orbital',
      launchSites: true,
      ports: false,
    })
  })
})
