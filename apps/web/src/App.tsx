/**
 * Application shell: fullscreen globe + HUD chrome. The right stack swaps
 * per ops mode (orbital → telemetry+passes, maritime → vessel, airspace →
 * aircraft); live-feed polling starts once here. Below the compact
 * breakpoint (core/ui/useCompactLayout) the side panels become a dock of
 * sheets plus a selection chip (app/CompactHud); the globe never remounts.
 * HIDE / U (core/ui/hudStore) fades the whole HUD layer out and makes it
 * inert; only the restore button and the Cesium credits stay on screen.
 */
import { useEffect } from 'react'
import { CompactHud } from './app/CompactHud'
import { GlobeView } from './app/GlobeView'
import { HelpButton, HelpOverlay } from './app/HelpOverlay'
import { HideControlsButton, ShowControlsButton } from './app/HudVisibility'
import { SettingsButton, SettingsPanel } from './app/SettingsPanel'
import { LeftRail } from './app/LeftRail'
import { ModeTabs } from './app/ModeTabs'
import { SelectionPanels } from './app/SelectionPanels'
import { StatusLine } from './app/StatusLine'
import { transportVisible, useMode } from './core/ui/modeStore'
import { showHudOnModalOpen, useHud } from './core/ui/hudStore'
import { closeSheetOnModalOpen } from './core/ui/sheetStore'
import { useCompactLayout } from './core/ui/useCompactLayout'
import { useHudShortcuts } from './core/ui/useHudShortcuts'
import { startAircraftPolling, stopAircraftPolling } from './features/airspace/aircraftStore'
import { useCatalog } from './features/catalog/catalogStore'
import { startShipsPolling, stopShipsPolling } from './features/maritime/shipsStore'
import { TransportBar } from './features/timebar/TransportBar'

export default function App() {
  const booting = useCatalog((s) => s.booting)
  const init = useCatalog((s) => s.init)
  const transportOn = useMode(transportVisible)
  const compact = useCompactLayout()
  const hudHidden = useHud((s) => s.hidden)
  useHudShortcuts()

  useEffect(() => {
    void init()
    startShipsPolling()
    startAircraftPolling()
    return () => {
      stopShipsPolling()
      stopAircraftPolling()
    }
  }, [init])

  // HELP / COLORS are modal: opening one closes any compact sheet
  useEffect(() => closeSheetOnModalOpen(), [])
  // ...and opening one while the HUD is hidden (H / ?) brings the HUD back
  useEffect(() => showHudOnModalOpen(), [])

  return (
    // .has-transport: the transport bar is mounted, so the 900–1365px CSS
    // lifts the launchers / credits over it
    <div
      className={`app-root${compact ? ' is-compact' : ''}${transportOn ? ' has-transport' : ''}${hudHidden ? ' is-hud-hidden' : ''}`}
    >
      <GlobeView />
      {/* inert while hidden: out of the tab order and the accessibility
          tree at once; the CSS fade ends in visibility:hidden */}
      <div className="hud-layer" inert={hudHidden}>
        <StatusLine />
        <ModeTabs />
        {compact ? (
          <CompactHud />
        ) : (
          <>
            <LeftRail />
            <div className="right-stack">
              <SelectionPanels />
            </div>
            {transportOn && <TransportBar />}
            <div className="hud-launchers">
              <HelpButton />
              <SettingsButton />
              <HideControlsButton />
            </div>
          </>
        )}
        <HelpOverlay />
        <SettingsPanel />
      </div>
      {hudHidden && <ShowControlsButton />}
      {booting && (
        <div className="boot-overlay">
          <div className="boot-text">ACQUIRING CATALOG…</div>
        </div>
      )}
    </div>
  )
}
