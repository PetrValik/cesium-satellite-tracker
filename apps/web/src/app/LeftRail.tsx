import { useMode } from '../core/ui/modeStore'
import { AirPicture } from '../features/airspace/AirPicture'
import { CatalogPanel } from '../features/catalog/CatalogPanel'
import { MaritimePicture } from '../features/maritime/MaritimePicture'
import { LayersPanel } from './LayersPanel'

/**
 * Left instrument rail: composes the active mode's slice content plus the
 * always-present layer toggles. Slices stay ignorant of each other — this
 * app-layer component is the only place they meet.
 */
export function LeftRail() {
  const mode = useMode((s) => s.mode)
  const satellitesOn = useMode((s) => s.satellitesVisible)
  const shipsOn = useMode((s) => s.shipsVisible)
  const aircraftOn = useMode((s) => s.aircraftVisible)
  // The focused domain's picture only renders while its layer is on — with
  // every domain toggled off the rail is just the LAYERS panel.
  return (
    <section className="hud-panel catalog-panel">
      {mode === 'orbital' && satellitesOn && <CatalogPanel />}
      {mode === 'maritime' && shipsOn && <MaritimePicture />}
      {mode === 'airspace' && aircraftOn && <AirPicture />}
      <LayersPanel />
    </section>
  )
}
