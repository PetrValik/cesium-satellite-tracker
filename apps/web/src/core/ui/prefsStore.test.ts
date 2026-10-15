import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'orbital-ops.prefs'

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

/** Fresh store module against the given storage contents (prefs load at import). */
async function loadStore(initial?: Record<string, string>) {
  const backing = stubStorage(initial)
  vi.resetModules()
  const { usePrefs, DEFAULT_COLORS } = await import('./prefsStore')
  return { usePrefs, DEFAULT_COLORS, backing }
}

const CAMERA = { x: 1, y: 2, z: 3, headingRad: 0.1, pitchRad: -0.5, rollRad: 0 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('prefsStore load', () => {
  it('starts from the default palette, no camera, streets', async () => {
    const { usePrefs, DEFAULT_COLORS } = await loadStore()
    const s = usePrefs.getState()
    expect(s.colors).toEqual(DEFAULT_COLORS)
    expect(s.colors).not.toBe(DEFAULT_COLORS) // a copy — edits never touch the defaults
    expect(s.lastCamera).toBeNull()
    expect(s.basemap).toBe('streets')
  })

  it('falls back to defaults on corrupted JSON', async () => {
    const { usePrefs, DEFAULT_COLORS } = await loadStore({ [STORAGE_KEY]: '{not json' })
    expect(usePrefs.getState().colors).toEqual(DEFAULT_COLORS)
    expect(usePrefs.getState().basemap).toBe('streets')
  })

  it('falls back to defaults on a stored null', async () => {
    const { usePrefs } = await loadStore({ [STORAGE_KEY]: 'null' })
    expect(usePrefs.getState().lastCamera).toBeNull()
  })

  it('keeps valid stored colours and drops invalid or unknown ones', async () => {
    const { usePrefs, DEFAULT_COLORS } = await loadStore({
      [STORAGE_KEY]: JSON.stringify({
        colors: {
          aircraft: { civil: '#123456', cargo: 'red', military: 42 },
          ships: { cargo: '#ABCDEF', submarine: '#000000' },
          satellites: 'not an object',
        },
      }),
    })
    const { colors } = usePrefs.getState()
    expect(colors.aircraft).toEqual({
      civil: '#123456',
      cargo: DEFAULT_COLORS.aircraft.cargo,
      military: DEFAULT_COLORS.aircraft.military,
    })
    expect(colors.ships.cargo).toBe('#ABCDEF')
    expect(colors.ships).not.toHaveProperty('submarine')
    expect(colors.satellites).toEqual(DEFAULT_COLORS.satellites)
  })

  it('restores a finite camera and rejects a non-finite one', async () => {
    const good = await loadStore({ [STORAGE_KEY]: JSON.stringify({ lastCamera: CAMERA }) })
    expect(good.usePrefs.getState().lastCamera).toEqual(CAMERA)

    // JSON cannot carry NaN/Infinity; a missing or non-number field is the real-world corruption.
    const bad = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ lastCamera: { ...CAMERA, z: 'far' } }),
    })
    expect(bad.usePrefs.getState().lastCamera).toBeNull()

    const partial = await loadStore({
      [STORAGE_KEY]: JSON.stringify({ lastCamera: { x: 1, y: 2 } }),
    })
    expect(partial.usePrefs.getState().lastCamera).toBeNull()
  })

  it('accepts a known basemap and rejects an unknown one', async () => {
    const topo = await loadStore({ [STORAGE_KEY]: JSON.stringify({ basemap: 'topo' }) })
    expect(topo.usePrefs.getState().basemap).toBe('topo')

    const unknown = await loadStore({ [STORAGE_KEY]: JSON.stringify({ basemap: 'blueprint' }) })
    expect(unknown.usePrefs.getState().basemap).toBe('streets')
  })
})

describe('prefsStore actions', () => {
  it('setColor accepts a #rrggbb hex and persists it', async () => {
    const { usePrefs, backing } = await loadStore()
    usePrefs.getState().setColor('ships', 'tanker', '#010203')
    expect(usePrefs.getState().colors.ships.tanker).toBe('#010203')
    expect(JSON.parse(backing.get(STORAGE_KEY)!).colors.ships.tanker).toBe('#010203')
  })

  it('setColor rejects anything that is not #rrggbb', async () => {
    const { usePrefs, DEFAULT_COLORS, backing } = await loadStore()
    for (const bad of ['red', '#fff', '#12345g', 'rgb(1,2,3)', '']) {
      usePrefs.getState().setColor('ships', 'tanker', bad)
    }
    expect(usePrefs.getState().colors.ships.tanker).toBe(DEFAULT_COLORS.ships.tanker)
    expect(backing.has(STORAGE_KEY)).toBe(false)
  })

  it('resetColors restores the defaults and keeps camera and basemap', async () => {
    const { usePrefs, DEFAULT_COLORS, backing } = await loadStore()
    usePrefs.getState().setBasemap('satellite')
    usePrefs.getState().saveCamera(CAMERA)
    usePrefs.getState().setColor('aircraft', 'civil', '#000000')

    usePrefs.getState().resetColors()
    const s = usePrefs.getState()
    expect(s.colors).toEqual(DEFAULT_COLORS)
    expect(s.basemap).toBe('satellite')
    expect(s.lastCamera).toEqual(CAMERA)
    expect(JSON.parse(backing.get(STORAGE_KEY)!).colors).toEqual(DEFAULT_COLORS)
  })

  it('what persist() writes is exactly what load() restores', async () => {
    const { usePrefs, backing } = await loadStore()
    usePrefs.getState().setColor('satellites', 'GEO', '#abcdef')
    usePrefs.getState().setBasemap('topo')
    usePrefs.getState().saveCamera(CAMERA)

    const reloaded = await loadStore({ [STORAGE_KEY]: backing.get(STORAGE_KEY)! })
    const s = reloaded.usePrefs.getState()
    expect(s.colors.satellites.GEO).toBe('#abcdef')
    expect(s.basemap).toBe('topo')
    expect(s.lastCamera).toEqual(CAMERA)
  })
})
