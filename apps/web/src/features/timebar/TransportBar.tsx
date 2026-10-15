/**
 * Transport bar (tape-deck): play/pause, warp rates, ±12 h scrub against
 * wall-now, NOW reset, UTC readout. The scrub keeps a transient local value
 * only while dragging; it must reset on pointer/key release or the slider
 * freezes at a stale offset.
 *
 * Wide screens show the full segmented warp cluster; the compact (phone)
 * layout swaps it for a − rate + stepper over the same SIM_RATES, and the
 * UTC readout splits into date / time spans so CSS can stack them. Which
 * one shows is pure CSS (styles/transport.css), so both stay in the DOM.
 */
import { useState } from 'react'
import { SIM_RATES, stepRate, useSimClock } from '../../core/sim/simClock'
import { useWallClock } from '../../core/sim/wallClock'
import { formatRate, formatUtc } from '../../lib/format'
import { SCRUB_RANGE_MIN, scrubOffsetMin, scrubSliderValue } from './scrub'

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

  const offsetMin = scrubOffsetMin(utcSeconds * 1000, nowMs)
  // Stepper neighbours: core/sim's one rate walk (the , / . keys use it too).
  const slower = stepRate(rate, -1)
  const faster = stepRate(rate, 1)
  const [utcDate, utcTime] = formatUtc(utcSeconds * 1000).split(' ')

  return (
    <section className="hud-panel transport-bar">
      <button
        className="hud-button transport-play"
        onClick={togglePlay}
        aria-label={playing ? 'Pause simulation time' : 'Play simulation time'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="transport-rates" role="group" aria-label="Time warp">
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
      <div className="transport-stepper" role="group" aria-label="Time warp">
        <button
          className="hud-button rate-step"
          onClick={() => slower !== undefined && setRate(slower)}
          disabled={slower === undefined}
          aria-label="Slower time warp"
        >
          −
        </button>
        <output className="rate-current" aria-label="Current time warp">
          {formatRate(rate)}
        </output>
        <button
          className="hud-button rate-step"
          onClick={() => faster !== undefined && setRate(faster)}
          disabled={faster === undefined}
          aria-label="Faster time warp"
        >
          +
        </button>
      </div>
      <input
        className="transport-scrub"
        type="range"
        name="scrub"
        aria-label="Scrub simulation time ±12 h"
        min={-SCRUB_RANGE_MIN}
        max={SCRUB_RANGE_MIN}
        step={1}
        value={scrubSliderValue(scrub, offsetMin)}
        onChange={(e) => {
          const minutes = Number(e.target.value)
          setScrub(minutes)
          scrubTo(Date.now() + minutes * 60_000)
        }}
        onPointerUp={() => setScrub(0)}
        // a touch drag the browser takes over (scroll/zoom) ends in
        // pointercancel, not pointerup — reset there too
        onPointerCancel={() => setScrub(0)}
        onKeyUp={() => setScrub(0)}
        onBlur={() => setScrub(0)}
        title="Scrub ±12 h"
      />
      <button className="hud-button transport-now" onClick={resetToNow}>
        NOW
      </button>
      <time className="transport-utc">
        <span className="utc-date">{utcDate}</span> <span className="utc-time">{utcTime}</span>{' '}
        <span className="utc-zone">UTC</span>
      </time>
    </section>
  )
}
