import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIGNAL_AMBER, SIGNAL_GROUND } from '../engine/signalColors'

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

/** Written out, not imported: editing the frozen v1 table or the v2 defaults fails here. */
const V1 = {
  aircraft: { civil: '#4da6ff', cargo: '#f87171', military: '#7dd87d' },
  ships: { cargo: '#6ee7ff', tanker: '#ffb454', passenger: '#c084fc', fishing: '#7dd87d', highspeed: '#f0f4f8', military: '#f87171', other: '#8a93a3' },
  satellites: { LEO: '#ffb454', MEO: '#6ee7ff', GEO: '#c084fc', HEO: '#f87171' },
}
const V2 = {
  aircraft: { civil: '#4da6ff', cargo: '#7dd87d', military: '#f87171' },
  ships: { cargo: '#7dd87d', tanker: '#c084fc', passenger: '#4da6ff', fishing: '#2dd4bf', highspeed: '#ff5f8f', military: '#f87171', other: '#8a93a3' },
  satellites: { LEO: '#a8f0ff', MEO: '#a3e635', GEO: '#ffd166', HEO: '#ffa1b5' },
}
const stored = (b: Map<string, string>) => JSON.parse(b.get(STORAGE_KEY)!)

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
    const { usePrefs, DEFAULT_COLORS, backing } = await loadStore({ [STORAGE_KEY]: '{not json' })
    expect(usePrefs.getState().colors).toEqual(DEFAULT_COLORS)
    expect(usePrefs.getState().basemap).toBe('streets')
    expect(backing.get(STORAGE_KEY)).toBe('{not json')
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
    expect(stored(backing).colors).toEqual(V2)
    expect(stored(backing).paletteVersion).toBe(2)
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

describe('prefsStore palette v2', () => {
  it('defaults to one hue per meaning', async () => {
    expect((await loadStore()).DEFAULT_COLORS).toEqual(V2)
  })
  it('paints a shared meaning alike in every domain and never defaults to the selection amber', async () => {
    const d = (await loadStore()).DEFAULT_COLORS
    expect(d.ships.military).toBe(d.aircraft.military)
    expect(d.ships.passenger).toBe(d.aircraft.civil)
    expect(d.ships.cargo).toBe(d.aircraft.cargo)
    expect(d.ships.other).toBe(SIGNAL_GROUND)
    expect(Object.values(d).flatMap((x) => Object.values(x))).not.toContain(SIGNAL_AMBER)
  })
})

describe('prefsStore v1 -> v2 migration', () => {
  it('moves an untouched v1 palette to the v2 defaults and persists it as v2 at load', async () => {
    const { usePrefs, backing } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors: V1, lastCamera: CAMERA, basemap: 'topo' }) })
    expect(usePrefs.getState().colors).toEqual(V2)
    expect(stored(backing)).toEqual({ paletteVersion: 2, colors: V2, lastCamera: CAMERA, basemap: 'topo' })
  })
  it("keeps every colour the user picked, including another key's v1 default", async () => {
    const colors = { ...V1, ships: { ...V1.ships, cargo: '#7dd87d', tanker: '#c27a2e' }, satellites: { ...V1.satellites, LEO: '#123456' } }
    const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors }) })
    const c = usePrefs.getState().colors
    expect([c.ships.cargo, c.ships.tanker, c.satellites.LEO]).toEqual(['#7dd87d', '#c27a2e', '#123456'])
    expect([c.ships.fishing, c.satellites.MEO]).toEqual(['#2dd4bf', '#a3e635'])
  })
  it('matches a v1 default case-insensitively', async () => {
    const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ colors: { ships: { tanker: '#FFB454' } } }) })
    expect(usePrefs.getState().colors.ships.tanker).toBe('#c084fc')
  })
  it('reads v2 prefs unchanged and writes nothing at load', async () => {
    const raw = JSON.stringify({ paletteVersion: 2, colors: { ...V2, ships: { ...V2.ships, tanker: '#ffb454' } } })
    const { usePrefs, backing } = await loadStore({ [STORAGE_KEY]: raw })
    expect(usePrefs.getState().colors.ships.tanker).toBe('#ffb454')
    expect(backing.get(STORAGE_KEY)).toBe(raw)
  })
  it('treats a missing or non-2 version as v1 and still drops invalid colours', async () => {
    for (const paletteVersion of [undefined, 1, '2', null]) {
      const { usePrefs } = await loadStore({ [STORAGE_KEY]: JSON.stringify({ paletteVersion, colors: { ships: { tanker: '#ffb454', cargo: 'cyan' }, satellites: 42 } }) })
      const c = usePrefs.getState().colors
      expect([c.ships.tanker, c.ships.cargo], String(paletteVersion)).toEqual(['#c084fc', '#7dd87d'])
      expect(c.satellites).toEqual(V2.satellites)
    }
  })
  it('stamps paletteVersion 2 on every write, so a reload never re-migrates a pick', async () => {
    const first = await loadStore()
    first.usePrefs.getState().setColor('ships', 'tanker', '#ffb454')
    expect(stored(first.backing).paletteVersion).toBe(2)
    const again = await loadStore({ [STORAGE_KEY]: first.backing.get(STORAGE_KEY)! })
    expect(again.usePrefs.getState().colors.ships.tanker).toBe('#ffb454')
  })
})
