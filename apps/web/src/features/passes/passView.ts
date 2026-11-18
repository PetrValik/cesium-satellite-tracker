import { formatCountdown } from '../../lib/format'
import type { PassPrediction } from '../../lib/protocol'

/** What the NEXT PASS panel shows at one sim instant. */
export interface PassView {
  /** First pass not yet over (LOS at or after now); −1 when none is left. */
  nextIndex: number
  /** The pass drawn on the sky plot: a picked pass until it ends, else the next. */
  shownIndex: number
  /** Heading suffix: `IN …` before AOS, `NOW · ENDS IN …` from AOS through LOS; null with no next pass. */
  countdown: string | null
}

/** The one place that decides the next pass, the shown pass and the countdown. */
export function passView(
  passes: readonly PassPrediction[],
  selectedPass: number | null,
  epochMs: number,
): PassView {
  const nextIndex = passes.findIndex((p) => p.losMs >= epochMs)
  const pickedLive = selectedPass !== null && (passes[selectedPass]?.losMs ?? -1) >= epochMs
  const shownIndex = pickedLive ? selectedPass : nextIndex
  if (nextIndex < 0) return { nextIndex, shownIndex, countdown: null }
  const next = passes[nextIndex]
  const countdown =
    epochMs < next.aosMs
      ? `IN ${formatCountdown(next.aosMs - epochMs)}`
      : `NOW · ENDS IN ${formatCountdown(next.losMs - epochMs)}`
  return { nextIndex, shownIndex, countdown }
}
