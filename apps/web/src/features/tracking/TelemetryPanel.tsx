/**
 * Selected-satellite readout: identity from the catalog, live numbers from
 * the telemetry store (pushed by the render loop at ~5 Hz). The CLASS badge
 * wears the hue the globe paints that orbit class with (user palette).
 */
import { FollowButton } from '../../core/ui/FollowButton'
import { hueStyle } from '../../core/ui/hueStyle'
import { usePrefs } from '../../core/ui/prefsStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import { tleInclinationDeg } from './satSummary'
import { useTelemetry } from './telemetryStore'
import { formatDeg, formatKm, formatLatLon } from '../../lib/format'

export function TelemetryPanel() {
  const noradId = useTelemetry((s) => s.noradId)
  const name = useTelemetry((s) => s.name)
  const orbitClass = useTelemetry((s) => s.orbitClass)
  const altKm = useTelemetry((s) => s.altKm)
  const velocityKmS = useTelemetry((s) => s.velocityKmS)
  const latDeg = useTelemetry((s) => s.latDeg)
  const lonDeg = useTelemetry((s) => s.lonDeg)
  const periodMinutes = useTelemetry((s) => s.periodMinutes)
  const classColor = usePrefs((s) => (orbitClass === null ? null : s.colors.satellites[orbitClass]))
  const select = useSatellites((s) => s.select)
  const sat = useSatellites((s) => (noradId === null ? undefined : s.byId.get(noradId)))

  if (noradId === null) return null
  const inclinationDeg = sat ? tleInclinationDeg(sat.tle2) : null

  return (
    // telemetry-panel: a rule-less hook shared by the three selection panels
    <section className="hud-panel telemetry-panel">
      <header className="telemetry-header">
        <h2 className="hud-title">TRACKING</h2>
        <span className="panel-actions">
          <FollowButton />
          <button className="hud-button" onClick={() => select(null)} title="Deselect (Esc)">
            ✕
          </button>
        </span>
      </header>
      <div className="telemetry-name">{name}</div>
      <dl className="telemetry-grid">
        <dt>NORAD</dt>
        <dd>{noradId}</dd>
        <dt>CLASS</dt>
        <dd className="orbit-class" style={classColor === null ? undefined : hueStyle(classColor)}>
          {orbitClass ?? '—'}
        </dd>
        <dt>ALT</dt>
        <dd>{formatKm(altKm)}</dd>
        <dt>VEL</dt>
        <dd>{velocityKmS.toFixed(2)} KM/S</dd>
        <dt>POS</dt>
        <dd>{formatLatLon(latDeg, lonDeg)}</dd>
        <dt>PERIOD</dt>
        <dd>{periodMinutes.toFixed(1)} MIN</dd>
        <dt>INCL</dt>
        <dd>{inclinationDeg === null ? '—' : formatDeg(inclinationDeg, 1)}</dd>
        <dt>GROUPS</dt>
        <dd>{sat?.groups.join(' · ').toUpperCase() ?? '—'}</dd>
      </dl>
    </section>
  )
}
