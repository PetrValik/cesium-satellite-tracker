import { useMode } from '../core/ui/modeStore'
import { AircraftPanel } from '../features/airspace/AircraftPanel'
import { ShipPanel } from '../features/maritime/ShipPanel'
import { PassesPanel } from '../features/passes/PassesPanel'
import { TelemetryPanel } from '../features/tracking/TelemetryPanel'

/**
 * The focused mode's selection panels (orbital → telemetry + passes,
 * maritime → vessel, airspace → aircraft). Each returns null until something
 * is selected. Rendered in the desktop right stack and the compact details sheet.
 */
export function SelectionPanels() {
  const mode = useMode((s) => s.mode)
  return (
    <>
      {mode === 'orbital' && (
        <>
          <TelemetryPanel />
          <PassesPanel />
        </>
      )}
      {mode === 'maritime' && <ShipPanel />}
      {mode === 'airspace' && <AircraftPanel />}
    </>
  )
}
