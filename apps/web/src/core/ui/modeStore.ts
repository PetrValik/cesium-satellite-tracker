import { create } from 'zustand'
import { readStored, writeStored } from '../../lib/storage'

export const OPS_MODES = ['orbital', 'maritime', 'airspace'] as const
export type OpsMode = (typeof OPS_MODES)[number]

const STORAGE_KEY = 'orbital-ops.mode'

interface StoredMode {
  mode: OpsMode
  launchSites: boolean
  ports: boolean
  satellitesVisible: boolean
  shipsVisible: boolean
  aircraftVisible: boolean
}

const DEFAULT_MODE: StoredMode = {
  mode: 'orbital',
  launchSites: true,
  ports: false,
  satellitesVisible: true,
  shipsVisible: false,
  aircraftVisible: false,
}

function parseStoredMode(value: unknown): StoredMode {
  const parsed = value as Partial<StoredMode>
  return {
    mode: OPS_MODES.includes(parsed.mode as OpsMode) ? (parsed.mode as OpsMode) : 'orbital',
    launchSites: parsed.launchSites === true,
    ports: parsed.ports === true,
    // Satellites default ON (the boot mode is ORBITAL and must not open
    // on an empty globe); only an explicit false hides them.
    satellitesVisible: parsed.satellitesVisible !== false,
    // Live layers default OFF — all three domains at once made the
    // first load unreadably busy. Only an explicit true shows them
    // (toggleDomain / setMode re-enable a domain's layer when it is focused).
    shipsVisible: parsed.shipsVisible === true,
    aircraftVisible: parsed.aircraftVisible === true,
  }
}

export interface ModeState extends StoredMode {
  /** Help overlay visibility (not persisted). */
  helpOpen: boolean
  /** Color settings panel visibility (not persisted). */
  settingsOpen: boolean
  setMode: (mode: OpsMode) => void
  /** Tab click: toggle a domain's layer; enabling also focuses its panels. */
  toggleDomain: (mode: OpsMode) => void
  /**
   * LAYERS row: toggle a domain's layer without taking focus. Hiding the
   * focused domain still drops focus the way toggleDomain does.
   */
  toggleLayer: (mode: OpsMode) => void
  toggleLaunchSites: () => void
  togglePorts: () => void
  toggleHelp: () => void
  closeHelp: () => void
  toggleSettings: () => void
  closeSettings: () => void
}

function persist(state: StoredMode): void {
  writeStored(STORAGE_KEY, {
    mode: state.mode,
    launchSites: state.launchSites,
    ports: state.ports,
    satellitesVisible: state.satellitesVisible,
    shipsVisible: state.shipsVisible,
    aircraftVisible: state.aircraftVisible,
  })
}

/** Each domain's layer-visibility flag. */
const DOMAIN_FLAG = {
  orbital: 'satellitesVisible',
  maritime: 'shipsVisible',
  airspace: 'aircraftVisible',
} as const satisfies Record<OpsMode, keyof StoredMode>

type DomainFlag = (typeof DOMAIN_FLAG)[OpsMode]

/** Whether `mode`'s layer is shown — the domain → flag mapping for components. */
export function isDomainVisible(s: Pick<StoredMode, DomainFlag>, mode: OpsMode): boolean {
  return s[DOMAIN_FLAG[mode]]
}

/**
 * Time warp only moves satellites (live feeds suspend under warp), so the
 * transport controls — the bar, the sim-rate readout and their keys — travel
 * with the ORBITAL layer. The one place that rule is written.
 */
export function transportVisible(s: Pick<StoredMode, 'satellitesVisible'>): boolean {
  return s.satellitesVisible
}

/** First visible domain in tab order — where focus falls when the focused one hides. */
function firstVisibleDomain(s: StoredMode): OpsMode | null {
  for (const m of OPS_MODES) if (s[DOMAIN_FLAG[m]]) return m
  return null
}

/**
 * MFD-style ops mode: which domain the HUD focuses on. Layers may render
 * simultaneously; the mode picks the catalog/tracking panels shown, which
 * layer a globe pick prefers, and what the follow camera rides. Infra
 * overlays toggle independently.
 */
export const useMode = create<ModeState>((set) => {
  /** Flip one persisted infra-overlay flag. */
  const toggleFlag = (flag: 'launchSites' | 'ports') => () =>
    set((s) => {
      const next = { ...s, [flag]: !s[flag] }
      persist(next)
      return { [flag]: next[flag] }
    })

  /**
   * Flip a domain's layer. Hiding the focused domain drops focus to the
   * first still-visible one (tabs read left-to-right as a priority order);
   * hiding a background domain leaves focus alone. Showing a domain focuses
   * it only when `focusOnShow` (tab click, not LAYERS row).
   */
  const flipDomain = (m: OpsMode, focusOnShow: boolean) =>
    set((s) => {
      const flag = DOMAIN_FLAG[m]
      const visible = !s[flag]
      let mode = s.mode
      if (visible) {
        if (focusOnShow) mode = m
      } else if (s.mode === m) {
        mode = firstVisibleDomain({ ...s, [flag]: false }) ?? s.mode
      }
      persist({ ...s, [flag]: visible, mode })
      return { [flag]: visible, mode }
    })

  return {
    ...(readStored(STORAGE_KEY, parseStoredMode) ?? DEFAULT_MODE),
    helpOpen: false,
    settingsOpen: false,
    toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
    closeHelp: () => set({ helpOpen: false }),
    toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
    closeSettings: () => set({ settingsOpen: false }),
    setMode: (mode) =>
      set((s) => {
        // A focused mode never presents an empty world because its layer
        // was toggled off earlier: force-show that layer and persist it.
        const enable = { [DOMAIN_FLAG[mode]]: true }
        persist({ ...s, mode, ...enable })
        return { mode, ...enable }
      }),
    toggleDomain: (m) => flipDomain(m, true),
    toggleLayer: (m) => flipDomain(m, false),
    toggleLaunchSites: toggleFlag('launchSites'),
    togglePorts: toggleFlag('ports'),
  }
})
