/**
 * Transport bar (tape-deck): play/pause, warp rates, ±12 h scrub against
 * wall-now, NOW reset, UTC readout. The scrub keeps a transient local value
 * only while dragging; it must reset on pointer/key release or the slider
 * freezes at a stale offset.
 */
import { useState } from 'react'
import { SIM_RATES, useSimClock } from '../../core/sim/simClock'
import { formatRate, formatUtc } from '../../lib/format'
import { useWallClock } from '../../lib/wallClock'

const SCRUB_RANGE_MIN = 12 * 60 // ±12 h in minutes

export function TransportBar() {
  const utcSeconds = useSimClock((s) => Math.floor(s.epochMs / 1000))
  const rate = useSimClock((s) => s.rate)
  const playing = useSimClock((s) => s.playing)
  const togglePlay = useSimClock((s) => s.togglePlay)
  const setRate = useSimClock((s) => s.setRate)
  const scrubTo = useSimClock((s) => s.scrubTo)
  const resetToNow = useSimClock((s) => s.resetToNow)
  const [scrub, setScrub] = useState(0)
  const nowMs = useWallClock((s) => s.nowMs)

  const offsetMin = Math.round((utcSeconds * 1000 - nowMs) / 60_000)

  return (
    <section className="hud-panel transport-bar">
      <button className="hud-button transport-play" onClick={togglePlay}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="transport-rates">
        {SIM_RATES.map((r) => (
          <button
            key={r}
            className={`hud-button rate-button${r === rate ? ' is-active' : ''}`}
            onClick={() => setRate(r)}
          >
            {formatRate(r)}
          </button>
        ))}
      </div>
      <input
        className="transport-scrub"
        type="range"
        min={-SCRUB_RANGE_MIN}
        max={SCRUB_RANGE_MIN}
        step={1}
        value={scrub !== 0 ? scrub : Math.max(-SCRUB_RANGE_MIN, Math.min(SCRUB_RANGE_MIN, offsetMin))}
        onChange={(e) => {
          const minutes = Number(e.target.value)
          setScrub(minutes)
          scrubTo(Date.now() + minutes * 60_000)
        }}
        onPointerUp={() => setScrub(0)}
        onKeyUp={() => setScrub(0)}
        onBlur={() => setScrub(0)}
        title="Scrub ±12 h"
      />
      <button className="hud-button transport-now" onClick={resetToNow}>
        NOW
      </button>
      <time className="transport-utc">{formatUtc(utcSeconds * 1000)} UTC</time>
    </section>
  )
}
