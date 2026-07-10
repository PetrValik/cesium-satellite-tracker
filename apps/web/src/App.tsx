import { useEffect } from 'react'
import { GlobeView } from './app/GlobeView'
import { StatusLine } from './app/StatusLine'
import { CatalogPanel } from './features/catalog/CatalogPanel'
import { PassesPanel } from './features/passes/PassesPanel'
import { TelemetryPanel } from './features/tracking/TelemetryPanel'
import { TransportBar } from './features/timebar/TransportBar'
import { useCatalog } from './features/catalog/catalogStore'

export default function App() {
  const booting = useCatalog((s) => s.booting)
  const init = useCatalog((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="app-root">
      <GlobeView />
      <div className="hud-layer">
        <StatusLine />
        <CatalogPanel />
        <div className="right-stack">
          <TelemetryPanel />
          <PassesPanel />
        </div>
        <TransportBar />
      </div>
      {booting && (
        <div className="boot-overlay">
          <div className="boot-text">ACQUIRING CATALOG…</div>
        </div>
      )}
    </div>
  )
}
