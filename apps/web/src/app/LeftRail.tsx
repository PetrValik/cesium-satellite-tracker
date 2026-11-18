import { useLegendFolds } from '../core/ui/legendFoldStore'
import { LayersPanel } from './LayersPanel'
import { LegendSection } from './LegendSection'
import { legendSections, useRailPictures } from './railPicture'

/**
 * The picture of every domain that is on (catalog / vessel / air), stacked
 * in tab order. Shared by the desktop rail and the compact HUD's picture
 * sheet. With two or more on, each section folds; a lone picture renders
 * bare, as it always has. With every domain off the rail is just LAYERS.
 */
export function RailPictures() {
  const sections = legendSections(useRailPictures(), useLegendFolds((s) => s.folded))
  return sections.map((view) =>
    view.foldable ? (
      <LegendSection key={view.entry.mode} view={view} />
    ) : (
      <view.entry.Component key={view.entry.mode} />
    ),
  )
}

/**
 * Left instrument rail: every visible domain's picture, in tab order, plus
 * the always-present layer toggles. Slices stay ignorant of each other —
 * this is one of the app-layer places they meet.
 */
export function LeftRail() {
  return (
    <section className="hud-panel rail-panel">
      <RailPictures />
      <LayersPanel />
    </section>
  )
}
