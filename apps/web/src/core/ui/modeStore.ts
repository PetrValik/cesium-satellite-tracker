import { create } from 'zustand'

export const OPS_MODES = ['orbital', 'maritime', 'airspace'] as const
export type OpsMode = (typeof OPS_MODES)[number]

const STORAGE_KEY = 'orbital-ops.mode'

interface StoredMode {
  mode: OpsMode
  launchSites: boolean
  ports: boolean
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
      }
    }
  } catch {
    // corrupted storage — defaults below
  }
  return { mode: 'orbital', launchSites: true, ports: false }
}

export interface ModeState extends StoredMode {
  setMode: (mode: OpsMode) => void
  toggleLaunchSites: () => void
  togglePorts: () => void
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
}))
