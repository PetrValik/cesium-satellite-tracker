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
  it('defaults to a calm first load: satellites only', async () => {
    const { useMode } = await loadStore()
    expect(useMode.getState()).toMatchObject({
      mode: 'orbital',
      launchSites: true,
      ports: false,
      satellitesVisible: true,
      shipsVisible: false,
      aircraftVisible: false,
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

  it('shows live layers only on an explicit stored true', async () => {
    const explicit = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ mode: 'orbital', shipsVisible: true, aircraftVisible: true }),
    })
    expect(explicit.useMode.getState().shipsVisible).toBe(true)
    expect(explicit.useMode.getState().aircraftVisible).toBe(true)

    // Missing key (pre-satellite-toggle storage schema) → the calm default.
    const missing = await loadStore({ [STORAGE_KEY]: JSON.stringify({ mode: 'maritime' }) })
    expect(missing.useMode.getState().shipsVisible).toBe(false)
    expect(missing.useMode.getState().aircraftVisible).toBe(false)

    const truthy = await loadStore({ [STORAGE_KEY]: JSON.stringify({ shipsVisible: 1 }) })
    expect(truthy.useMode.getState().shipsVisible).toBe(false)
  })

  it('hides satellites only on an explicit stored false', async () => {
    const explicit = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ mode: 'orbital', satellitesVisible: false }),
    })
    expect(explicit.useMode.getState().satellitesVisible).toBe(false)

    const missing = await loadStore({ [STORAGE_KEY]: JSON.stringify({ mode: 'orbital' }) })
    expect(missing.useMode.getState().satellitesVisible).toBe(true)
  })
})

describe('modeStore persistence', () => {
  it('persists mode and infra toggles, surviving a reload', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().setMode('maritime')
    useMode.getState().toggleLaunchSites() // true -> false
    useMode.getState().togglePorts() // false -> true

    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
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

  it('round-trips every visibility toggle through storage', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().toggleSatellites() // true -> false
    useMode.getState().toggleShips() // false -> true
    useMode.getState().toggleAircraft() // false -> true

    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toEqual({
      mode: 'orbital',
      launchSites: true,
      ports: false,
      satellitesVisible: false,
      shipsVisible: true,
      aircraftVisible: true,
    })

    // What persist() wrote is exactly what load() restores.
    const reloaded = await loadStore({ [STORAGE_KEY]: backing.get(STORAGE_KEY)! })
    expect(reloaded.useMode.getState()).toMatchObject({
      satellitesVisible: false,
      shipsVisible: true,
      aircraftVisible: true,
    })
  })

  it('setMode force-shows the target domain layer and persists it', async () => {
    const { useMode, backing } = await loadStore()
    expect(useMode.getState().shipsVisible).toBe(false)

    useMode.getState().setMode('maritime')
    expect(useMode.getState().shipsVisible).toBe(true)
    // Other layers are untouched — only the tab being opened is forced on.
    expect(useMode.getState().aircraftVisible).toBe(false)
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
      mode: 'maritime',
      shipsVisible: true,
    })

    useMode.getState().setMode('airspace')
    expect(useMode.getState().aircraftVisible).toBe(true)

    // Re-show satellites after they were toggled off, then reopen ORBITAL.
    useMode.getState().toggleSatellites() // true -> false
    useMode.getState().setMode('orbital')
    expect(useMode.getState().satellitesVisible).toBe(true)
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
      mode: 'orbital',
      satellitesVisible: true,
    })
  })
})
