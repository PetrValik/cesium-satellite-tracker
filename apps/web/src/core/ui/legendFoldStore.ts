import { create } from 'zustand'
import { readStored, writeStored } from '../../lib/storage'
import { OPS_MODES, type OpsMode } from './modeStore'

/** Which stacked legend sections are folded, per domain. */
export type LegendFolds = Record<OpsMode, boolean>

export interface LegendFoldState {
  folded: LegendFolds
  /** Fold or unfold one domain's section and remember it in this browser. */
  toggleFold: (mode: OpsMode) => void
}

const STORAGE_KEY = 'orbital-ops.legend-folds'

/** A fresh record over OPS_MODES; only a stored `true` folds (storage is untrusted). */
function parse(value: unknown): LegendFolds {
  const stored = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const folds = {} as LegendFolds
  for (const mode of OPS_MODES) folds[mode] = stored[mode] === true
  return folds
}

/**
 * Fold state of the stacked legend (left rail and phone LEGEND sheet).
 * Sections start unfolded; a lone section ignores its stored fold.
 */
export const useLegendFolds = create<LegendFoldState>((set, get) => ({
  folded: readStored(STORAGE_KEY, parse) ?? parse(null),
  toggleFold: (mode) => {
    const folded = { ...get().folded, [mode]: !get().folded[mode] }
    writeStored(STORAGE_KEY, folded)
    set({ folded })
  },
}))
