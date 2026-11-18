import type { ComponentType } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LegendFolds } from '../core/ui/legendFoldStore'
import { isDomainVisible, OPS_MODES, useMode, type ModeState, type OpsMode } from '../core/ui/modeStore'
import { AirPicture } from '../features/airspace/AirPicture'
import { CatalogPanel } from '../features/catalog/CatalogPanel'
import { MaritimePicture } from '../features/maritime/MaritimePicture'
import { formatCount } from '../lib/format'

export interface RailPictureEntry {
  mode: OpsMode
  /** Section heading, dock button and sheet title on the compact HUD. */
  label: string
  Component: ComponentType
}

/** Each domain's left-rail picture (catalog / vessel / air). Module constants: identity is stable. */
const PICTURES: Record<OpsMode, RailPictureEntry> = {
  orbital: { mode: 'orbital', label: 'CATALOG', Component: CatalogPanel },
  maritime: { mode: 'maritime', label: 'VESSELS', Component: MaritimePicture },
  airspace: { mode: 'airspace', label: 'AIRCRAFT', Component: AirPicture },
}

/*
 * The legend rules, in one place for the desktop rail, the compact dock and
 * the picture sheet: which pictures stack, what the dock button reads, which
 * sections fold and what a section heading counts.
 */

/** The picture of every domain whose layer is on, in tab order; focus never reorders it. */
export function visiblePictures(
  s: Pick<ModeState, 'satellitesVisible' | 'shipsVisible' | 'aircraftVisible'>,
): RailPictureEntry[] {
  return OPS_MODES.filter((mode) => isDomainVisible(s, mode)).map((mode) => PICTURES[mode])
}

/** React: the visible pictures. useShallow keeps the fresh array from re-rendering forever. */
export function useRailPictures(): RailPictureEntry[] {
  return useMode(useShallow(visiblePictures))
}

/** Dock button text: null with no domain on, the domain's name with one, LEGEND with two or more. */
export function pictureDockLabel(pictures: readonly RailPictureEntry[]): string | null {
  if (pictures.length === 0) return null
  return pictures.length === 1 ? pictures[0].label : 'LEGEND'
}

export interface LegendSectionView {
  entry: RailPictureEntry
  foldable: boolean
  folded: boolean
}

/** A lone section never folds (nothing to make room for); its stored fold waits for a second domain. */
export function legendSections(
  pictures: readonly RailPictureEntry[],
  folded: Readonly<LegendFolds>,
): LegendSectionView[] {
  const foldable = pictures.length > 1
  return pictures.map((entry) => ({ entry, foldable, folded: foldable && folded[entry.mode] }))
}

/**
 * A section heading's live count. VESSELS and AIRCRAFT read SUSP while sim
 * time is off NOW (the LAYERS convention); satellites move in sim time.
 */
export function legendCount(
  mode: OpsMode,
  counts: Readonly<Record<OpsMode, number>>,
  simLive: boolean,
): string {
  return mode !== 'orbital' && !simLive ? 'SUSP' : formatCount(counts[mode])
}

/**
 * The focused domain's picture, or null while that domain's layer is off.
 * Kept until the stacked legend (LeftRail / CompactHud) replaces its callers.
 */
export function useRailPicture(): RailPictureEntry | null {
  return useMode((s) => (isDomainVisible(s, s.mode) ? PICTURES[s.mode] : null))
}
