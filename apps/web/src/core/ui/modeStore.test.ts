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
  const { useMode, transportVisible } = await import('./modeStore')
  return { useMode, transportVisible, backing }
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
    useMode.getState().toggleLayer('orbital') // true -> false
    useMode.getState().toggleLayer('maritime') // false -> true
    useMode.getState().toggleLayer('airspace') // false -> true

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
    useMode.getState().toggleLayer('orbital') // true -> false
    useMode.getState().setMode('orbital')
    expect(useMode.getState().satellitesVisible).toBe(true)
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
      mode: 'orbital',
      satellitesVisible: true,
    })
  })
})

describe('toggleDomain (tab clicks)', () => {
  it('enabling a domain shows its layer and focuses it', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().toggleDomain('airspace')
    expect(useMode.getState()).toMatchObject({ mode: 'airspace', aircraftVisible: true })
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
      mode: 'airspace',
      aircraftVisible: true,
    })
  })

  it('disabling the focused domain drops focus to the first visible one', async () => {
    const { useMode } = await loadStore()
    useMode.getState().toggleDomain('maritime') // ships on, focus maritime
    expect(useMode.getState().mode).toBe('maritime')

    useMode.getState().toggleDomain('maritime') // ships off again
    expect(useMode.getState().shipsVisible).toBe(false)
    // Satellites are still on (calm default) → focus falls to orbital.
    expect(useMode.getState().mode).toBe('orbital')
  })

  it('disabling a background domain leaves focus alone', async () => {
    const { useMode } = await loadStore()
    useMode.getState().toggleDomain('airspace') // focus airspace
    useMode.getState().toggleDomain('orbital') // hide satellites (background)
    expect(useMode.getState()).toMatchObject({ mode: 'airspace', satellitesVisible: false })
  })

  it('keeps focus when the last visible domain is disabled', async () => {
    const { useMode } = await loadStore()
    useMode.getState().toggleDomain('orbital') // satellites off — nothing visible
    expect(useMode.getState().satellitesVisible).toBe(false)
    expect(useMode.getState().mode).toBe('orbital')

    // All domains may be active at once — tabs are independent toggles.
    useMode.getState().toggleDomain('orbital')
    useMode.getState().toggleDomain('maritime')
    useMode.getState().toggleDomain('airspace')
    expect(useMode.getState()).toMatchObject({
      satellitesVisible: true,
      shipsVisible: true,
      aircraftVisible: true,
      mode: 'airspace',
    })
  })
})

describe('toggleLayer (LAYERS rows)', () => {
  it('showing a layer leaves focus where it is', async () => {
    const { useMode, backing } = await loadStore()
    useMode.getState().toggleLayer('maritime')
    expect(useMode.getState()).toMatchObject({ mode: 'orbital', shipsVisible: true })
    expect(JSON.parse(backing.get(STORAGE_KEY)!)).toMatchObject({
      mode: 'orbital',
      shipsVisible: true,
    })
  })

  it('hiding the focused domain drops focus to the first visible one', async () => {
    const { useMode } = await loadStore()
    useMode.getState().toggleDomain('maritime') // ships on, focus maritime
    useMode.getState().toggleDomain('airspace') // aircraft on, focus airspace
    useMode.getState().toggleLayer('orbital') // satellites off (background)
    expect(useMode.getState().mode).toBe('airspace')

    useMode.getState().toggleLayer('airspace') // hide the focused domain
    expect(useMode.getState()).toMatchObject({ mode: 'maritime', aircraftVisible: false })
  })

  it('keeps focus when the last visible domain is hidden', async () => {
    const { useMode } = await loadStore()
    useMode.getState().toggleLayer('orbital')
    expect(useMode.getState()).toMatchObject({ mode: 'orbital', satellitesVisible: false })
  })
})

describe('mode selectors', () => {
  it('isDomainVisible maps each domain to its own layer flag', async () => {
    const { isDomainVisible } = await import('./modeStore')
    const flags = { satellitesVisible: true, shipsVisible: false, aircraftVisible: true }
    expect(isDomainVisible(flags, 'orbital')).toBe(true)
    expect(isDomainVisible(flags, 'maritime')).toBe(false)
    expect(isDomainVisible(flags, 'airspace')).toBe(true)
  })

  it('transportVisible follows the ORBITAL layer only', async () => {
    const { useMode, transportVisible } = await loadStore()
    expect(transportVisible(useMode.getState())).toBe(true)
    useMode.getState().toggleLayer('maritime')
    useMode.getState().toggleLayer('airspace')
    expect(transportVisible(useMode.getState())).toBe(true)
    useMode.getState().toggleLayer('orbital')
    expect(transportVisible(useMode.getState())).toBe(false)
  })
})
