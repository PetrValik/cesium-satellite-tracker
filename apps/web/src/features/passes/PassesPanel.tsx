import { useEffect, useState } from 'react'
import { simClock, useSimClock } from '../../core/sim/simClock'
import { formatDuration, formatUtcTime } from '../../lib/format'
import { createSatrec, predictPasses } from '../../lib/orbital'
import { useCatalog } from '../catalog/catalogStore'
import { usePasses } from './passesStore'
import { SkyPlot } from './SkyPlot'

const WINDOW_HOURS = 24

export function PassesPanel() {
  const sat = useCatalog((s) => (s.selectedId === null ? undefined : s.byId.get(s.selectedId)))
  const observer = usePasses((s) => s.observer)
  const passes = usePasses((s) => s.passes)
  const computing = usePasses((s) => s.computing)
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
    if (!satrec) {
      usePasses.getState().clear()
      return
    }
    usePasses.getState().startCompute(sat.noradId)
    // Defer off the click handler so the panel paints its "COMPUTING…" state.
    const timer = setTimeout(() => {
      const startMs = simClock.get().epochMs
      const result = predictPasses(satrec, usePasses.getState().observer, startMs, WINDOW_HOURS)
      usePasses.getState().setResults(sat.noradId, result, startMs)
    }, 10)
    return () => clearTimeout(timer)
  }, [sat, observer, windowExpired])

  if (!sat) return null

  const shownIndex =
    selectedPass ?? passes.findIndex((p) => p.losMs >= epochMs)
  const shown = shownIndex >= 0 ? passes[shownIndex] : undefined

  return (
    <section className="hud-panel passes-panel">
      <h2 className="hud-title">PASSES · NEXT {WINDOW_HOURS} H</h2>
      <ObserverEditor />
      {computing && <div className="passes-empty">COMPUTING…</div>}
      {!computing && passes.length === 0 && (
        <div className="passes-empty">NO PASSES ABOVE 5° FOR THIS OBSERVER</div>
      )}
      {!computing && passes.length > 0 && !shown && (
        <div className="passes-empty">WINDOW ELAPSED — RECOMPUTING…</div>
      )}
      {!computing && shown && (
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

  const commit = () => {
    const latDeg = Number(lat)
    const lonDeg = Number(lon)
    if (Number.isFinite(latDeg) && Math.abs(latDeg) <= 90 && Number.isFinite(lonDeg) && Math.abs(lonDeg) <= 180) {
      setObserver({ latDeg, lonDeg, heightM: observer.heightM })
    } else {
      setLat(String(observer.latDeg))
      setLon(String(observer.lonDeg))
    }
  }

  const useGps = () => {
    navigator.geolocation?.getCurrentPosition((pos) => {
      const next = {
        latDeg: Number(pos.coords.latitude.toFixed(4)),
        lonDeg: Number(pos.coords.longitude.toFixed(4)),
        heightM: pos.coords.altitude ?? 200,
      }
      setObserver(next)
      setLat(String(next.latDeg))
      setLon(String(next.lonDeg))
    })
  }

  return (
    <div className="observer-editor">
      <span className="observer-label">OBS</span>
      <input
        className="hud-input observer-input"
        value={lat}
        onChange={(e) => setLat(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label="Observer latitude"
      />
      <input
        className="hud-input observer-input"
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
  )
}
