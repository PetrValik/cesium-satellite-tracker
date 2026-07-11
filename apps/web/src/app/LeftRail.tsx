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
  return (
    <section className="hud-panel catalog-panel">
      {mode === 'orbital' && <CatalogPanel />}
      {mode === 'maritime' && <MaritimePicture />}
      {mode === 'airspace' && <AirPicture />}
      <LayersPanel />
    </section>
  )
}
