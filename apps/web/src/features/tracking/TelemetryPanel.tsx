/**
 * Selected-satellite readout, grouped for reading at a glance: NOW (live,
 * pushed by the render loop at ~5 Hz) and ORBIT (from the TLE, pushed once
 * per selection), then a small identity line. The class badge wears the hue
 * the globe paints that orbit class with (user palette).
 */
import { useSimClock } from '../../core/sim/simClock'
import { FollowButton } from '../../core/ui/FollowButton'
import { hueStyle } from '../../core/ui/hueStyle'
import { usePrefs } from '../../core/ui/prefsStore'
import { useSatellites } from '../../core/ui/satelliteStore'
import { formatDataAge, formatDeg, formatKm, formatLatLon, formatUtc } from '../../lib/format'
import { formatOrbitPeriod, formatOrbitSpan, tleInclinationDeg } from './satSummary'
import { useTelemetry } from './telemetryStore'

export function TelemetryPanel() {
  const t = useTelemetry()
  const classColor = usePrefs((s) =>
    t.orbitClass === null ? null : s.colors.satellites[t.orbitClass],
  )
  const select = useSatellites((s) => s.select)
  const sat = useSatellites((s) => (t.noradId === null ? undefined : s.byId.get(t.noradId)))
  // Data age is measured against sim time (what the shown position is
  // propagated to), refreshed once per sim minute like the passes panel.
  const simMin = useSimClock((s) => Math.floor(s.epochMs / 60_000))

  if (t.noradId === null) return null
  const inclinationDeg = sat ? tleInclinationDeg(sat.tle2) : null
  // A no-break space before each dot: a wrapped line never starts with '·'.
  const groups = sat?.groups.join('\u00a0· ').toUpperCase()

  return (
    // telemetry-panel: a rule-less hook shared by the three selection panels
    <section className="hud-panel telemetry-panel sat-detail">
      <header className="telemetry-header sat-title">
        <h2 className="telemetry-name" title={t.name}>
          {t.name}
        </h2>
        <span
          className="orbit-class"
          style={classColor === null ? undefined : hueStyle(classColor)}
        >
          {t.orbitClass ?? '—'}
        </span>
        <span className="panel-actions">
          <FollowButton />
          <button className="hud-button" onClick={() => select(null)} title="Deselect (Esc)">
            ✕
          </button>
        </span>
      </header>

      <h3 className="sat-block-title">NOW</h3>
      <p className="sat-line">
        {formatKm(t.altKm, 0)} · {t.velocityKmS.toFixed(2)} KM/S
        {t.sunlit !== null && (
          <>
            {' · '}
            {t.sunlit ? (
              <span className="sat-sunlit">☀︎ SUNLIT</span>
            ) : (
              <span className="sat-shadow">● IN SHADOW</span>
            )}
          </>
        )}
      </p>
      <p className="sat-line">OVER {formatLatLon(t.latDeg, t.lonDeg)}</p>

      <h3 className="sat-block-title">ORBIT</h3>
      <p className="sat-line">{formatOrbitPeriod(t.periodMinutes)}</p>
      <p className="sat-line">
        <span
          title={`Lowest–highest altitude over one orbit. Perigee–apogee ${Math.round(t.perigeeKm)}–${Math.round(t.apogeeKm)} km above the 6378 km equatorial radius.`}
        >
          {formatOrbitSpan(t.lowKm, t.highKm)}
        </span>
        {inclinationDeg !== null && (
          <>
            {' · '}
            <span title="Inclination: the orbit's angle to the equator">
              TILTED {formatDeg(inclinationDeg, 1)}
            </span>
          </>
        )}
      </p>
      <p className="sat-line">
        {t.launchYear !== null && <>LAUNCHED {t.launchYear} · </>}
        {t.tleEpochMs !== null && (
          <span
            title={`TLE epoch ${formatUtc(t.tleEpochMs)} UTC — position accuracy falls the further sim time is from it`}
          >
            DATA {formatDataAge(simMin * 60_000 - t.tleEpochMs)}
          </span>
        )}
      </p>

      <p className="sat-identity">
        NORAD {t.noradId}
        {t.designator !== null && (
          <>
            {'\u00a0· '}
            <span title="International designator: launch year, launch number, piece">
              {t.designator}
            </span>
          </>
        )}
        {groups && <>{'\u00a0· '}{groups}</>}
      </p>
    </section>
  )
}
