/** One record parsed from 3-line TLE text. */
export interface ParsedTle {
  noradId: number
  name: string
  tle1: string
  tle2: string
}

/** Fetches raw 3-line TLE text for one CelesTrak group. Injectable for tests. */
export type TleFetcher = (celestrakGroup: string) => Promise<string>

const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php'
const TLE_LINE_LENGTH = 69

// Alpha-5 letters: I and O are unused to avoid confusion with 1 and 0.
const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Decode the catalog-number field of a TLE line. Plain digits for ids
 * up to 99999; Alpha-5 (leading letter = 10..33) above that.
 */
export function parseNoradId(field: string): number {
  const s = field.trim()
  if (!s) return NaN
  const first = s[0]!
  if (first >= 'A' && first <= 'Z') {
    const idx = ALPHA5.indexOf(first)
    if (idx === -1) return NaN
    const rest = Number(s.slice(1))
    return Number.isInteger(rest) ? (idx + 10) * 10_000 + rest : NaN
  }
  const n = Number(s)
  return Number.isInteger(n) ? n : NaN
}

/**
 * Parse CelesTrak 3-line TLE format (name line + line 1 + line 2).
 * Malformed entries are skipped, never thrown on.
 */
export function parseTleText(text: string): ParsedTle[] {
  const out: ParsedTle[] = []
  let pendingName = ''
  let line1 = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.startsWith('1 ') && line.length === TLE_LINE_LENGTH) {
      line1 = line
    } else if (line.startsWith('2 ') && line.length === TLE_LINE_LENGTH && line1) {
      const id1 = parseNoradId(line1.slice(2, 7))
      const id2 = parseNoradId(line.slice(2, 7))
      if (Number.isFinite(id1) && id1 === id2) {
        out.push({
          noradId: id1,
          name: pendingName || `NORAD ${id1}`,
          tle1: line1,
          tle2: line,
        })
      }
      line1 = ''
      pendingName = ''
    } else {
      pendingName = line.trim()
      line1 = ''
    }
  }
  return out
}

/** Production fetcher against the CelesTrak GP endpoint. */
export const fetchCelestrakGroup: TleFetcher = async (celestrakGroup) => {
  const url = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(celestrakGroup)}&FORMAT=tle`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      'user-agent': 'orbital-ops-tle-cache/1.0 (+https://github.com/PetrValik/cesium-satellite-tracker)',
    },
  })
  if (!res.ok) {
    throw new Error(`CelesTrak responded ${res.status} for group ${celestrakGroup}`)
  }
  return res.text()
}
