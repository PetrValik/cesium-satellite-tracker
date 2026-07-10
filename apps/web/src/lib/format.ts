const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, '0')

/** "2026-07-10 18:04:33" (UTC). */
export function formatUtc(epochMs: number): string {
  const d = new Date(epochMs)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  )
}

/** "18:04:33" (UTC). */
export function formatUtcTime(epochMs: number): string {
  const d = new Date(epochMs)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** Thin-space thousands separator: 12408 -> "12 408". */
export function formatCount(n: number): string {
  return Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** "417.3 KM" style readout. */
export function formatKm(km: number, digits = 1): string {
  return `${km.toFixed(digits)} KM`
}

export function formatDeg(deg: number, digits = 2): string {
  return `${deg.toFixed(digits)}°`
}

/** Latitude/longitude as "51.64°N 14.27°E". */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(2)}°${latDeg >= 0 ? 'N' : 'S'}`
  const lon = `${Math.abs(lonDeg).toFixed(2)}°${lonDeg >= 0 ? 'E' : 'W'}`
  return `${lat} ${lon}`
}

/** Age of data: "3 H" / "42 MIN" / "9 D". */
export function formatAge(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} MIN`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} H`
  return `${Math.round(h / 24)} D`
}

/** Pass duration "06:42" (mm:ss). */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${pad(s / 60)}:${pad(s % 60)}`
}

/** Warp factor for the status line: "×60" / "−×60". */
export function formatRate(rate: number): string {
  return rate < 0 ? `−×${Math.abs(rate)}` : `×${rate}`
}
