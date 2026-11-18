/**
 * NEXT PASS OVER YOU for the selected satellite: a 24 h prediction window
 * anchored at sim time, recomputed when the satellite, the observer or the
 * window changes (windowExpired flips when sim time warps/scrubs outside
 * it). The heading counts down in sim time; the next pass reads AOS (UTC),
 * rise → set direction, max elevation, duration and the naked-eye flag;
 * WATCH ▶ jumps sim time to a pass's AOS and plays at ×10. The observer
 * folds to one FROM … · CHANGE line.
 */
import { useEffect, useState } from 'react'
import { simClock, useSimClock } from '../../core/sim/simClock'
import { useSatellites } from '../../core/ui/satelliteStore'
import { formatCompass8, formatCountdown, formatLatLon, formatUtcHm } from '../../lib/format'
import { createSatrec, MIN_MAX_ELEVATION_DEG, predictPasses } from '../../lib/orbital'
import type { PassPrediction } from '../../lib/protocol'
import { DEFAULT_OBSERVER, isValidObserver } from './observer'
import { usePasses } from './passesStore'
import { passView, type PassView } from './passView'
import { SkyPlot } from './SkyPlot'

const WINDOW_HOURS = 24

const NO_VIEW: PassView = { nextIndex: -1, shownIndex: -1, countdown: null }

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
  // previous one's passes (startCompute leaves them in place) — never paint
  // those under this satellite's name: while busy, nothing reads `passes`.
  const busy = computing || computedFor !== sat.noradId
  const view = busy ? NO_VIEW : passView(passes, selectedPass, epochMs)
  const next = view.nextIndex >= 0 ? passes[view.nextIndex] : undefined
  const shown = view.shownIndex >= 0 ? passes[view.shownIndex] : undefined
  const later = next ? passes.slice(view.nextIndex + 1) : []

  return (
    // passes-panel: a rule-less hook for tests and tooling
    <section className="hud-panel passes-panel">
      <h2 className="hud-title">
        NEXT PASS OVER YOU{view.countdown && ` · ${view.countdown}`}
      </h2>
      {busy && <div className="panel-empty">COMPUTING…</div>}
      {!busy && passes.length === 0 && (
        <div className="panel-empty">NO PASSES ABOVE {MIN_MAX_ELEVATION_DEG}° FOR THIS OBSERVER</div>
      )}
      {!busy && passes.length > 0 && !next && (
        <div className="panel-empty">WINDOW ELAPSED — RECOMPUTING…</div>
      )}
      {next && (
        <ul className="pass-list pass-next">
          <PassRow
            pass={next}
            index={view.nextIndex}
            isNext
            active={view.nextIndex === view.shownIndex}
            onSelect={selectPass}
          />
        </ul>
      )}
      {shown && <SkyPlot pass={shown} epochMs={simClock.get().epochMs} />}
      {later.length > 0 && (
        <>
          <div className="pass-later-label">LATER</div>
          <ul className="pass-list">
            {later.map((p, k) => {
              const i = view.nextIndex + 1 + k
              return (
                <PassRow
                  key={p.aosMs}
                  pass={p}
                  index={i}
                  isNext={false}
                  active={i === view.shownIndex}
                  onSelect={selectPass}
                />
              )
            })}
          </ul>
        </>
      )}
      <ObserverLine />
    </section>
  )
}

/** One pass: AOS (UTC), rise → set, max elevation, duration, naked-eye flag, WATCH ▶. */
function PassRow({
  pass,
  index,
  isNext,
  active,
  onSelect,
}: {
  pass: PassPrediction
  index: number
  isNext: boolean
  active: boolean
  onSelect: (index: number) => void
}) {
  const hm = formatUtcHm(pass.aosMs)
  return (
    <li className={active ? 'is-active' : ''}>
      <button className="pass-row" onClick={() => onSelect(index)}>
        <span>{isNext ? `${hm} UTC` : hm}</span>
        <span>{`${formatCompass8(pass.riseAzDeg)} → ${formatCompass8(pass.setAzDeg)}`}</span>
        <span>{Math.round(pass.maxElDeg)}°</span>
        <span>{formatCountdown(pass.losMs - pass.aosMs)}</span>
        {pass.nakedEye && (
          <span
            className="pass-eye"
            title="Naked-eye pass: sunlit while the Sun is more than 6° below your horizon"
          >
            {isNext ? '◉ EYE' : '◉'}
          </span>
        )}
      </button>
      <button
        className="hud-button pass-goto"
        title="Jump sim time to this pass's start and play at ×10"
        aria-label={`Watch the ${hm} UTC pass`}
        onClick={() => {
          simClock.get().scrubTo(pass.aosMs)
          simClock.get().setRate(10)
          simClock.get().play()
          onSelect(index)
        }}
      >
        WATCH ▶
      </button>
    </li>
  )
}

/** The observer folded to one line; CHANGE opens today's editor (remounted, so it re-reads the store). */
function ObserverLine() {
  const observer = usePasses((s) => s.observer)
  const [editing, setEditing] = useState(false)
  return (
    <div className="observer-line">
      {editing ? (
        <ObserverEditor />
      ) : (
        <span className="observer-from">FROM {formatLatLon(observer.latDeg, observer.lonDeg)}</span>
      )}
      <button
        type="button"
        className="hud-button observer-change"
        aria-expanded={editing}
        onClick={() => setEditing(!editing)}
      >
        {editing ? 'DONE' : 'CHANGE'}
      </button>
    </div>
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
