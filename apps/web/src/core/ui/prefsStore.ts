import { create } from 'zustand'
import type { ShipType } from '@orbital-ops/shared'
import type { OrbitClass } from '../../lib/protocol'

const STORAGE_KEY = 'orbital-ops.prefs'

export interface ColorPrefs {
  aircraft: Record<'civil' | 'cargo' | 'military', string>
  ships: Record<ShipType, string>
  satellites: Record<OrbitClass, string>
}

/**
 * Default palette per the owner's scheme: aircraft hue = category (civil
 * blue, cargo red, military green; ground renders grey regardless) with
 * altitude driving the shade in the layer; ships by type; satellites by
 * orbit class.
 */
export const DEFAULT_COLORS: ColorPrefs = {
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

export interface SavedCamera {
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

function mergeColors(stored: Partial<ColorPrefs> | undefined): ColorPrefs {
  const merged: ColorPrefs = structuredClone(DEFAULT_COLORS)
  if (!stored) return merged
  for (const domain of ['aircraft', 'ships', 'satellites'] as const) {
    const source = stored[domain] as Record<string, string> | undefined
    if (!source) continue
    const target = merged[domain] as Record<string, string>
    for (const key of Object.keys(target)) {
      const value = source[key]
      if (typeof value === 'string' && HEX_RE.test(value)) target[key] = value
    }
  }
  return merged
}

function load(): StoredPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredPrefs>
      const cam = parsed.lastCamera
      const lastCamera =
        cam &&
        [cam.x, cam.y, cam.z, cam.headingRad, cam.pitchRad, cam.rollRad].every(Number.isFinite)
          ? cam
          : null
      const basemap = BASEMAPS.includes(parsed.basemap as Basemap)
        ? (parsed.basemap as Basemap)
        : 'streets'
      return { colors: mergeColors(parsed.colors), lastCamera, basemap }
    }
  } catch {
    // corrupted storage — defaults below
  }
  return { colors: structuredClone(DEFAULT_COLORS), lastCamera: null, basemap: 'streets' }
}

function persist(state: StoredPrefs): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        colors: state.colors,
        lastCamera: state.lastCamera,
        basemap: state.basemap,
      }),
    )
  } catch {
    // storage unavailable — prefs still work in-memory
  }
}

export interface PrefsState extends StoredPrefs {
  setColor: (domain: keyof ColorPrefs, key: string, hex: string) => void
  resetColors: () => void
  setBasemap: (basemap: Basemap) => void
  /** Persist the free camera so the next session opens where the user left off. */
  saveCamera: (camera: SavedCamera) => void
}

export const usePrefs = create<PrefsState>((set) => ({
  ...load(),
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
