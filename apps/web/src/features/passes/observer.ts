import type { ObserverGeo } from '../../lib/protocol'

/** Default observer: Prague (the project's home base). */
export const DEFAULT_OBSERVER: ObserverGeo = { latDeg: 50.08, lonDeg: 14.44, heightM: 200 }

/** A usable observer: finite coordinates with |lat| ≤ 90, |lon| ≤ 180 and a finite height. */
export function isValidObserver(o: ObserverGeo): boolean {
  return (
    Number.isFinite(o.latDeg) &&
    Math.abs(o.latDeg) <= 90 &&
    Number.isFinite(o.lonDeg) &&
    Math.abs(o.lonDeg) <= 180 &&
    Number.isFinite(o.heightM)
  )
}
