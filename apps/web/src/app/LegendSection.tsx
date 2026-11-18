import { useSimLive } from '../core/sim/simLive'
import { useLegendFolds } from '../core/ui/legendFoldStore'
import type { OpsMode } from '../core/ui/modeStore'
import { useAircraft } from '../features/airspace/aircraftStore'
import { useCatalog } from '../features/catalog/catalogStore'
import { useShips } from '../features/maritime/shipsStore'
import { legendCount, type LegendSectionView } from './railPicture'

/** The heading's live count; every store is read unconditionally (hooks never branch). */
function useLegendCount(mode: OpsMode): string {
  const orbital = useCatalog((s) => s.sats.length)
  const maritime = useShips((s) => s.ships.length)
  const airspace = useAircraft((s) => s.aircraft.length)
  const simLive = useSimLive()
  return legendCount(mode, { orbital, maritime, airspace }, simLive)
}

/**
 * One stacked legend section (two or more domains on): a fold toggle
 * heading with the live count, then the domain's picture. The body stays
 * mounted so aria-controls always resolves; the picture itself unmounts
 * while folded, so its stores stop re-rendering it.
 */
export function LegendSection({ view }: { view: LegendSectionView }) {
  const { mode, label, Component } = view.entry
  const toggleFold = useLegendFolds((s) => s.toggleFold)
  const count = useLegendCount(mode)
  return (
    <section className="legend-section">
      <h2 className="hud-title legend-heading">
        <button
          type="button"
          className="legend-fold"
          aria-expanded={!view.folded}
          aria-controls={`legend-body-${mode}`}
          onClick={() => toggleFold(mode)}
        >
          <span className="legend-chevron" aria-hidden>
            ▾
          </span>
          <span className="legend-label">{label}</span>
          <span className="legend-count">{count}</span>
        </button>
      </h2>
      <div id={`legend-body-${mode}`} className="legend-body" hidden={view.folded}>
        {!view.folded && <Component />}
      </div>
    </section>
  )
}
