import { create } from 'zustand'
import type { ShipType } from '@orbital-ops/shared'
import type { AircraftCategory } from '../../lib/aircraftCategories'
import type { OrbitClass } from '../../lib/protocol'
import { readStored, writeStored } from '../../lib/storage'

const STORAGE_KEY = 'orbital-ops.prefs'

export interface ColorPrefs {
  aircraft: Record<AircraftCategory, string>
  ships: Record<ShipType, string>
  satellites: Record<OrbitClass, string>
}

/**
 * Palette v2: one meaning, one hue in every domain. Military red,
 * civil aircraft / passenger vessels blue, cargo green, tanker violet,
 * fishing teal, high-speed craft hot pink, other grey (= SIGNAL_GROUND, the
 * colour of aircraft on the ground). Satellites by orbit class, all kept off
 * the selection amber (SIGNAL_AMBER marks the selected object only). In the
 * aircraft layer, altitude still sets the shade of the category hue.
 */
export const DEFAULT_COLORS: ColorPrefs = {
  aircraft: { civil: '#4da6ff', cargo: '#7dd87d', military: '#f87171' },
  ships: {
    cargo: '#7dd87d',
    tanker: '#c084fc',
    passenger: '#4da6ff',
    fishing: '#2dd4bf',
    highspeed: '#ff5f8f',
    military: '#f87171',
    other: '#8a93a3',
  },
  satellites: { LEO: '#a8f0ff', MEO: '#a3e635', GEO: '#ffd166', HEO: '#ffa1b5' },
}

/** Stored prefs without this version predate palette v2. */
const PALETTE_VERSION = 2

/**
 * Frozen: the defaults every visitor stored before palette v2. History, not
 * config — never edit. Typed loosely so a category added later has no v1
 * entry and never forces an invented one.
 */
const V1_DEFAULT_COLORS: Readonly<Record<keyof ColorPrefs, Readonly<Record<string, string>>>> = {
  aircraft: { civil: '#4da6ff', cargo: '#f87171', military: '#7dd87d' },
  ships: {
    cargo: '#6ee7ff',
    tanker: '#ffb454',
    passenger: '#c084fc',
    fishing: '#7dd87d',
    highspeed: '#f0f4f8',
    military: '#f87171',
    other: '#8a93a3',
  },
  satellites: { LEO: '#ffb454', MEO: '#6ee7ff', GEO: '#c084fc', HEO: '#f87171' },
}

export const BASEMAPS = ['streets', 'topo', 'satellite'] as const
export type Basemap = (typeof BASEMAPS)[number]

interface SavedCamera {
  x: number
  y: number
  z: number
  headingRad: number
  pitchRad: number
  rollRad: number
}

interface StoredPrefs {
  colors: ColorPrefs
  lastCamera: SavedCamera | null
  basemap: Basemap
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Stored colours over the v2 defaults. From v1 prefs, a colour equal to the
 * v1 default for the same key was never picked by the user: it moves to the
 * v2 default. Any other valid hex is a user choice and is kept.
 */
function mergeColors(stored: Partial<ColorPrefs> | undefined, fromV1: boolean): ColorPrefs {
  const merged: ColorPrefs = structuredClone(DEFAULT_COLORS)
  if (!stored) return merged
  for (const domain of ['aircraft', 'ships', 'satellites'] as const) {
    const source = stored[domain] as Record<string, string> | undefined
    if (!source) continue
    const target = merged[domain] as Record<string, string>
    for (const key of Object.keys(target)) {
      const value = source[key]
      if (typeof value !== 'string' || !HEX_RE.test(value)) continue
      const untouchedV1 = fromV1 && value.toLowerCase() === V1_DEFAULT_COLORS[domain][key]
      if (!untouchedV1) target[key] = value
    }
  }
  return merged
}

const defaultPrefs = (): StoredPrefs => ({
  colors: structuredClone(DEFAULT_COLORS),
  lastCamera: null,
  basemap: 'streets',
})

function parseStoredPrefs(value: unknown): { prefs: StoredPrefs; migrated: boolean } {
  const parsed = value as Partial<StoredPrefs> & { paletteVersion?: unknown }
  // Only the number 2 counts as v2; anything else (absent, 1, '2') is v1.
  const migrated = parsed.paletteVersion !== PALETTE_VERSION
  const cam = parsed.lastCamera
  const lastCamera =
    cam &&
    [cam.x, cam.y, cam.z, cam.headingRad, cam.pitchRad, cam.rollRad].every(Number.isFinite)
      ? cam
      : null
  const basemap = BASEMAPS.includes(parsed.basemap as Basemap)
    ? (parsed.basemap as Basemap)
    : 'streets'
  return {
    prefs: { colors: mergeColors(parsed.colors, migrated), lastCamera, basemap },
    migrated,
  }
}

function persist(state: StoredPrefs): void {
  writeStored(STORAGE_KEY, {
    paletteVersion: PALETTE_VERSION,
    colors: state.colors,
    lastCamera: state.lastCamera,
    basemap: state.basemap,
  })
}

/**
 * Stored prefs, migrated to palette v2 and saved once if they were v1.
 * Nothing stored or unreadable (corrupt JSON, null) gives the defaults and
 * writes nothing, so corrupt storage is left as it is.
 */
function loadPrefs(): StoredPrefs {
  const loaded = readStored(STORAGE_KEY, parseStoredPrefs)
  if (loaded === undefined) return defaultPrefs()
  if (loaded.migrated) persist(loaded.prefs)
  return loaded.prefs
}

export interface PrefsState extends StoredPrefs {
  setColor: (domain: keyof ColorPrefs, key: string, hex: string) => void
  resetColors: () => void
  setBasemap: (basemap: Basemap) => void
  /** Persist the free camera so the next session opens where the user left off. */
  saveCamera: (camera: SavedCamera) => void
}

export const usePrefs = create<PrefsState>((set) => ({
  ...loadPrefs(),
  setColor: (domain, key, hex) =>
    set((s) => {
      if (!HEX_RE.test(hex)) return s
      const colors: ColorPrefs = structuredClone(s.colors)
      ;(colors[domain] as Record<string, string>)[key] = hex
      persist({ colors, lastCamera: s.lastCamera, basemap: s.basemap })
      return { colors }
    }),
  resetColors: () =>
    set((s) => {
      const colors = structuredClone(DEFAULT_COLORS)
      persist({ colors, lastCamera: s.lastCamera, basemap: s.basemap })
      return { colors }
    }),
  setBasemap: (basemap) =>
    set((s) => {
      persist({ colors: s.colors, lastCamera: s.lastCamera, basemap })
      return { basemap }
    }),
  saveCamera: (lastCamera) =>
    set((s) => {
      persist({ colors: s.colors, lastCamera, basemap: s.basemap })
      return { lastCamera }
    }),
}))
