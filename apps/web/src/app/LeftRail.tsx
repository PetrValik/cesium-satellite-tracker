import { LayersPanel } from './LayersPanel'
import { useRailPicture } from './railPicture'

/**
 * The focused domain's picture (catalog / vessel / air). Shared by the
 * desktop rail and the compact HUD's picture sheet. With every domain
 * toggled off the rail is just the LAYERS panel.
 */
export function RailPicture() {
  const picture = useRailPicture()
  return picture && <picture.Component />
}

/**
 * Left instrument rail: composes the active mode's slice content plus the
 * always-present layer toggles. Slices stay ignorant of each other — this
 * app-layer component is the only place they meet.
 */
export function LeftRail() {
  return (
    <section className="hud-panel rail-panel">
      <RailPicture />
      <LayersPanel />
    </section>
  )
}
