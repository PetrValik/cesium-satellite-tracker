import type { ComponentType } from 'react'
import { isDomainVisible, useMode, type OpsMode } from '../core/ui/modeStore'
import { AirPicture } from '../features/airspace/AirPicture'
import { CatalogPanel } from '../features/catalog/CatalogPanel'
import { MaritimePicture } from '../features/maritime/MaritimePicture'

export interface RailPictureEntry {
  /** Dock button / sheet title on the compact HUD. */
  label: string
  Component: ComponentType
}

/** Each domain's left-rail picture (catalog / vessel / air). */
const PICTURES: Record<OpsMode, RailPictureEntry> = {
  orbital: { label: 'CATALOG', Component: CatalogPanel },
  maritime: { label: 'VESSELS', Component: MaritimePicture },
  airspace: { label: 'AIRCRAFT', Component: AirPicture },
}

/**
 * The focused domain's picture, or null while that domain's layer is off —
 * a picture only renders while its layer is on. The one gate shared by the
 * desktop rail (RailPicture) and the compact dock + picture sheet.
 */
export function useRailPicture(): RailPictureEntry | null {
  return useMode((s) => (isDomainVisible(s, s.mode) ? PICTURES[s.mode] : null))
}
