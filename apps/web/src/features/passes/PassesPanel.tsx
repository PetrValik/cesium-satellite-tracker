/**
 * Pass predictions for the selected satellite over the observer: 24 h
 * window anchored at sim time, recomputed when the satellite, observer, or
 * window changes (windowExpired flips when sim time warps/scrubs outside
 * it). The "→" buttons jump sim time to a pass's AOS and start playback.
 */
import { useEffect, useState } from 'react'
import { simClock, useSimClock } from '../../core/sim/simClock'
import { useSatellites } from '../../core/ui/satelliteStore'
import { formatDuration, formatUtcTime } from '../../lib/format'
import { createSatrec, MIN_MAX_ELEVATION_DEG, predictPasses } from '../../lib/orbital'
import { DEFAULT_OBSERVER, isValidObserver } from './observer'
import { usePasses } from './passesStore'
import { SkyPlot } from './SkyPlot'

const WINDOW_HOURS = 24

export function PassesPanel() {
  const sat = useSatellites((s) => (s.selectedId === null ? undefined : s.byId.get(s.selectedId)))
  const observer = usePasses((s) => s.observer)
  const passes = usePasses((s) => s.passes)
  const computing = usePasses((s) => s.computing)
  const computedFor = usePasses((s) => s.computedFor)
  const selectedPass = usePasses((s) => s.selectedPass)
  const selectPass = usePasses((s) => s.selectPass)
  const windowStartMs = usePasses((s) => s.windowStartMs)
  // Re-render each sim minute so the live marker and "next pass" stay fresh.
  const epochMin = useSimClock((s) => Math.floor(s.epochMs / 60_000))

  const epochMs = epochMin * 60_000
  // Sim time warped/scrubbed outside the predicted window → predictions stale.
  const windowExpired =
    windowStartMs !== null &&
    (epochMs < windowStartMs - 60_000 || epochMs > windowStartMs + WINDOW_HOURS * 3_600_000)

  useEffect(() => {
    if (!sat) {
      usePasses.getState().clear()
      return
    }
    // Read computedFor via getState(): keeping it out of the deps means the
    // startCompute() below can't retrigger this effect and cancel its own timer.
    if (usePasses.getState().computedFor === sat.noradId && !windowExpired) return
    const satrec = createSatrec(sat.tle1, sat.tle2)
    usePasses.getState().startCompute(sat.noradId)
    if (!satrec) {
      // An unusable element set has no passes: settle on an empty window.
      usePasses.getState().setResults(sat.noradId, [], simClock.get().epochMs)
      return
    }
    // Defer off the click handler so the panel paints its "COMPUTING…" state.
    const timer = setTimeout(() => {
      const startMs = simClock.get().epochMs
      const result = predictPasses(satrec, usePasses.getState().observer, startMs, WINDOW_HOURS)
      usePasses.getState().setResults(sat.noradId, result, startMs)
    }, 10)
    return () => {
      clearTimeout(timer)
      // Torn down before the timer fired (unmount, sheet closed, new deps):
      // drop the in-flight claim, or the early return above would see
      // computedFor match and leave the panel on COMPUTING… for good.
      const s = usePasses.getState()
      if (s.computing && s.computedFor === sat.noradId) s.clear()
    }
  }, [sat, observer, windowExpired])

  if (!sat) return null

  // Until the effect claims the new satellite, the store still holds the
  // previous one's passes — never paint those under this satellite's name.
  const busy = computing || computedFor !== sat.noradId
  const shownIndex = busy ? -1 : (selectedPass ?? passes.findIndex((p) => p.losMs >= epochMs))
  const shown = shownIndex >= 0 ? passes[shownIndex] : undefined

  return (
    // passes-panel: a rule-less hook for tests and tooling
    <section className="hud-panel passes-panel">
      <h2 className="hud-title">PASSES · NEXT {WINDOW_HOURS} H</h2>
      <ObserverEditor />
      {busy && <div className="panel-empty">COMPUTING…</div>}
      {!busy && passes.length === 0 && (
        <div className="panel-empty">NO PASSES ABOVE {MIN_MAX_ELEVATION_DEG}° FOR THIS OBSERVER</div>
      )}
      {!busy && passes.length > 0 && !shown && (
        <div className="panel-empty">WINDOW ELAPSED — RECOMPUTING…</div>
      )}
      {!busy && shown && (
        <>
          <SkyPlot pass={shown} epochMs={simClock.get().epochMs} />
          <ul className="pass-list">
            {passes.map((p, i) => (
              <li key={p.aosMs} className={i === shownIndex ? 'is-active' : ''}>
                <button className="pass-row" onClick={() => selectPass(i)}>
                  <span>{formatUtcTime(p.aosMs)}</span>
                  <span>EL {Math.round(p.maxElDeg)}°</span>
                  <span>{formatDuration(p.losMs - p.aosMs)}</span>
                </button>
                <button
                  className="hud-button pass-goto"
                  title="Jump sim time to AOS"
                  aria-label="Jump sim time to AOS"
                  onClick={() => {
                    simClock.get().scrubTo(p.aosMs)
                    simClock.get().setRate(10)
                    simClock.get().play()
                    selectPass(i)
                  }}
                >
                  →
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ObserverEditor() {
  const observer = usePasses((s) => s.observer)
  const setObserver = usePasses((s) => s.setObserver)
  const [lat, setLat] = useState(String(observer.latDeg))
  const [lon, setLon] = useState(String(observer.lonDeg))
  const [gpsError, setGpsError] = useState<string | null>(null)

  const commit = () => {
    const next = { latDeg: Number(lat), lonDeg: Number(lon), heightM: observer.heightM }
    if (isValidObserver(next)) {
      setObserver(next)
    } else {
      setLat(String(observer.latDeg))
      setLon(String(observer.lonDeg))
    }
  }

  const useGps = () => {
    if (!navigator.geolocation) {
      setGpsError('GPS UNAVAILABLE IN THIS BROWSER')
      return
    }
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          latDeg: Number(pos.coords.latitude.toFixed(4)),
          lonDeg: Number(pos.coords.longitude.toFixed(4)),
          heightM: pos.coords.altitude ?? DEFAULT_OBSERVER.heightM,
        }
        setObserver(next)
        setLat(String(next.latDeg))
        setLon(String(next.lonDeg))
      },
      (err) => {
        setGpsError(err.code === err.PERMISSION_DENIED ? 'GPS DENIED — LOCATION PERMISSION OFF' : 'GPS FIX FAILED')
      },
    )
  }

  return (
    <>
      <div className="observer-editor">
        <span className="observer-label">OBS</span>
        <input
          className="hud-input observer-input"
          name="observer-lat"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label="Observer latitude"
        />
        <input
          className="hud-input observer-input"
          name="observer-lon"
          value={lon}
          onChange={(e) => setLon(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          aria-label="Observer longitude"
        />
        <button className="hud-button" onClick={useGps} title="Use browser geolocation">
          GPS
        </button>
      </div>
      {gpsError !== null && (
        <div className="observer-error" role="status">
          {gpsError}
        </div>
      )}
    </>
  )
}
