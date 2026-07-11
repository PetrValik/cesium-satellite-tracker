import { create } from 'zustand'

export const OPS_MODES = ['orbital', 'maritime', 'airspace'] as const
export type OpsMode = (typeof OPS_MODES)[number]

const STORAGE_KEY = 'orbital-ops.mode'

interface StoredMode {
  mode: OpsMode
  launchSites: boolean
  ports: boolean
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
        // Live layers default ON; only an explicit false hides them.
        shipsVisible: parsed.shipsVisible !== false,
        aircraftVisible: parsed.aircraftVisible !== false,
      }
    }
  } catch {
    // corrupted storage — defaults below
  }
  return { mode: 'orbital', launchSites: true, ports: false, shipsVisible: true, aircraftVisible: true }
}

export interface ModeState extends StoredMode {
  /** Help overlay visibility (not persisted). */
  helpOpen: boolean
  /** Color settings panel visibility (not persisted). */
  settingsOpen: boolean
  setMode: (mode: OpsMode) => void
  toggleLaunchSites: () => void
  togglePorts: () => void
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
      JSON.stringify({ mode: state.mode, launchSites: state.launchSites, ports: state.ports }),
    )
  } catch {
    // storage unavailable — mode still works in-memory
  }
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
      const next = { ...s, mode }
      persist(next)
      return { mode }
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
