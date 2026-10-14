import { useMode } from '../core/ui/modeStore'
import { AirPicture } from '../features/airspace/AirPicture'
import { CatalogPanel } from '../features/catalog/CatalogPanel'
import { MaritimePicture } from '../features/maritime/MaritimePicture'
import { LayersPanel } from './LayersPanel'

/**
 * The focused domain's picture (catalog / vessel / air). Shared by the
 * desktop rail and the compact HUD's picture sheet.
 */
export function RailPicture() {
  const mode = useMode((s) => s.mode)
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  // The focused domain's picture only renders while its layer is on — with
  // every domain toggled off the rail is just the LAYERS panel.
  return (
    <>
      {mode === 'orbital' && satellitesOn && <CatalogPanel />}
      {mode === 'maritime' && shipsOn && <MaritimePicture />}
      {mode === 'airspace' && aircraftOn && <AirPicture />}
    </>
  )
}

/**
 * Left instrument rail: composes the active mode's slice content plus the
 * always-present layer toggles. Slices stay ignorant of each other — this
 * app-layer component is the only place they meet.
 */
export function LeftRail() {
  return (
    <section className="hud-panel catalog-panel">
      <RailPicture />
      <LayersPanel />
    </section>
  )
}
