import { create } from 'zustand'

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

function load(): StoredMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredMode>
      return {
        mode: OPS_MODES.includes(parsed.mode as OpsMode) ? (parsed.mode as OpsMode) : 'orbital',
        launchSites: parsed.launchSites === true,
        ports: parsed.ports === true,
        // Satellites default ON (the boot mode is ORBITAL and must not open
        // on an empty globe); only an explicit false hides them.
        satellitesVisible: parsed.satellitesVisible !== false,
        // Live layers default OFF — all three domains at once made the
        // first load unreadably busy. Only an explicit true shows them
        // (setMode re-enables the domain layer when its tab is opened).
        shipsVisible: parsed.shipsVisible === true,
        aircraftVisible: parsed.aircraftVisible === true,
      }
    }
  } catch {
    // corrupted storage — defaults below
  }
  return {
    mode: 'orbital',
    launchSites: true,
    ports: false,
    satellitesVisible: true,
    shipsVisible: false,
    aircraftVisible: false,
  }
}

export interface ModeState extends StoredMode {
  /** Help overlay visibility (not persisted). */
  helpOpen: boolean
  /** Color settings panel visibility (not persisted). */
  settingsOpen: boolean
  setMode: (mode: OpsMode) => void
  toggleLaunchSites: () => void
  togglePorts: () => void
  toggleSatellites: () => void
  toggleShips: () => void
  toggleAircraft: () => void
  toggleHelp: () => void
  closeHelp: () => void
  toggleSettings: () => void
  closeSettings: () => void
}

function persist(state: StoredMode): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        mode: state.mode,
        launchSites: state.launchSites,
        ports: state.ports,
        satellitesVisible: state.satellitesVisible,
        shipsVisible: state.shipsVisible,
        aircraftVisible: state.aircraftVisible,
      }),
    )
  } catch {
    // storage unavailable — mode still works in-memory
  }
}

/**
 * The layer a mode is about: switching to a tab force-shows that layer so a
 * mode never presents an empty world because it was toggled off earlier.
 */
function modeLayerOn(mode: OpsMode): Partial<StoredMode> {
  if (mode === 'orbital') return { satellitesVisible: true }
  if (mode === 'maritime') return { shipsVisible: true }
  return { aircraftVisible: true }
}

/**
 * MFD-style ops mode: which domain the HUD focuses on. Layers may render
 * simultaneously; the mode drives which catalog/tracking panels are shown
 * and which layer is emphasized. Infra overlays toggle independently.
 */
export const useMode = create<ModeState>((set) => ({
  ...load(),
  helpOpen: false,
  settingsOpen: false,
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  closeHelp: () => set({ helpOpen: false }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),
  closeSettings: () => set({ settingsOpen: false }),
  setMode: (mode) =>
    set((s) => {
      // Auto-enable the domain's own layer (see modeLayerOn) and persist it.
      const enable = modeLayerOn(mode)
      const next = { ...s, mode, ...enable }
      persist(next)
      return { mode, ...enable }
    }),
  toggleSatellites: () =>
    set((s) => {
      const next = { ...s, satellitesVisible: !s.satellitesVisible }
      persist(next)
      return { satellitesVisible: next.satellitesVisible }
    }),
  toggleLaunchSites: () =>
    set((s) => {
      const next = { ...s, launchSites: !s.launchSites }
      persist(next)
      return { launchSites: next.launchSites }
    }),
  togglePorts: () =>
    set((s) => {
      const next = { ...s, ports: !s.ports }
      persist(next)
      return { ports: next.ports }
    }),
  toggleShips: () =>
    set((s) => {
      const next = { ...s, shipsVisible: !s.shipsVisible }
      persist(next)
      return { shipsVisible: next.shipsVisible }
    }),
  toggleAircraft: () =>
    set((s) => {
      const next = { ...s, aircraftVisible: !s.aircraftVisible }
      persist(next)
      return { aircraftVisible: next.aircraftVisible }
    }),
}))
