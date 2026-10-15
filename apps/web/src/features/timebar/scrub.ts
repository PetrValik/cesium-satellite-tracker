/** Scrub reach either side of wall-now, in minutes (±12 h). */
export const SCRUB_RANGE_MIN = 12 * 60

/** Whole minutes the sim clock sits off wall time (negative = in the past). */
export function scrubOffsetMin(epochMs: number, nowMs: number): number {
  return Math.round((epochMs - nowMs) / 60_000)
}

/**
 * Slider position: the transient drag value while a drag is in progress
 * (non-zero), otherwise the sim offset clamped to ±SCRUB_RANGE_MIN.
 */
export function scrubSliderValue(dragMin: number, offsetMin: number): number {
  if (dragMin !== 0) return dragMin
  return Math.max(-SCRUB_RANGE_MIN, Math.min(SCRUB_RANGE_MIN, offsetMin))
}
