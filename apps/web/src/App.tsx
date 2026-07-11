import { useEffect } from 'react'
import { GlobeView } from './app/GlobeView'
import { HelpButton, HelpOverlay } from './app/HelpOverlay'
import { ModeTabs } from './app/ModeTabs'
import { StatusLine } from './app/StatusLine'
import { useMode } from './core/ui/modeStore'
import { AircraftPanel } from './features/airspace/AircraftPanel'
import { startAircraftPolling } from './features/airspace/aircraftStore'
import { CatalogPanel } from './features/catalog/CatalogPanel'
import { useCatalog } from './features/catalog/catalogStore'
import { ShipPanel } from './features/maritime/ShipPanel'
import { startShipsPolling } from './features/maritime/shipsStore'
import { PassesPanel } from './features/passes/PassesPanel'
import { TelemetryPanel } from './features/tracking/TelemetryPanel'
import { TransportBar } from './features/timebar/TransportBar'

export default function App() {
  const booting = useCatalog((s) => s.booting)
  const init = useCatalog((s) => s.init)
  const mode = useMode((s) => s.mode)

  useEffect(() => {
    void init()
    startShipsPolling()
    startAircraftPolling()
  }, [init])

  return (
    <div className="app-root">
      <GlobeView />
      <div className="hud-layer">
        <StatusLine />
        <ModeTabs />
        <CatalogPanel />
        <div className="right-stack">
          {mode === 'orbital' && (
            <>
              <TelemetryPanel />
              <PassesPanel />
            </>
          )}
          {mode === 'maritime' && <ShipPanel />}
          {mode === 'airspace' && <AircraftPanel />}
        </div>
        <TransportBar />
        <HelpButton />
        <HelpOverlay />
      </div>
      {booting && (
        <div className="boot-overlay">
          <div className="boot-text">ACQUIRING CATALOG…</div>
        </div>
      )}
    </div>
  )
}
