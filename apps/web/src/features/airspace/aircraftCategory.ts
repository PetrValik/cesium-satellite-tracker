/**
 * Civil / cargo / military classification for ADS-B aircraft. There is no
 * such flag in the protocol, so this is the standard heuristic stack (same
 * approach as tar1090): military ICAO-hex allocations + military callsign
 * prefixes, and cargo-carrier ICAO airline prefixes. Coverage is partial by
 * nature — anything unmatched is 'civil'.
 */
import type { Aircraft } from '@orbital-ops/shared'

export const AIRCRAFT_CATEGORIES = ['civil', 'cargo', 'military'] as const
export type AircraftCategory = (typeof AIRCRAFT_CATEGORIES)[number]

/** Well-known military ICAO-hex blocks (conservative subset). */
const MIL_HEX_RANGES: [number, number][] = [
  [0xadf7c8, 0xafffff], // USA military
  [0x43c000, 0x43cfff], // UK military
  [0x3aa000, 0x3affff], // France military
  [0x3b7000, 0x3bffff], // France military
  [0x3ea000, 0x3ebfff], // Germany military
  [0x3f4000, 0x3fbfff], // Germany military
  [0x33ff00, 0x33ffff], // Italy military
  [0x478100, 0x4781ff], // Norway military
  [0x480000, 0x480fff], // Netherlands military
  [0x44f000, 0x44ffff], // Belgium military
  [0x497c00, 0x497cff], // Portugal military
  [0x4b7000, 0x4b7fff], // Switzerland military
  [0x4b8200, 0x4b82ff], // Turkey military
  [0x7cf800, 0x7cfaff], // Australia military
]

/** Military callsign prefixes (flight-plan callsigns, not registrations). */
const MIL_CALLSIGN_PREFIXES = [
  'RCH', // USAF Air Mobility Command "Reach"
  'CNV', // US Navy convoy
  'PAT', // US Army Priority Air Transport
  'SAM', // Special Air Mission (US)
  'EVAC', // US aeromedical
  'RRR', // Royal Air Force
  'ASCOT', // RAF transport
  'KRF', // RAF tanker "Vulcan"? kept conservative below
  'GAF', // German Air Force
  'FAF', // French Air Force
  'CTM', // French COTAM
  'IAM', // Italian Air Force
  'BAF', // Belgian Air Force
  'NAF', // Netherlands Air Force
  'CFC', // Canadian Forces
  'PLF', // Polish Air Force
  'HUF', // Hungarian Air Force
  'CEF', // Czech Air Force
  'SVF', // Swedish Air Force
  'NOW', // Norwegian Air Force? conservative — NOW is also weather; excluded at match time by length
  'NATO',
  'DUKE', // US Army Europe
  'HKY', // US ANG "Hickory"
  'LAGR', // US ANG "La Garde"
]

/** ICAO airline prefixes of major cargo operators. */
const CARGO_CALLSIGN_PREFIXES = [
  'FDX', // FedEx
  'UPS', // UPS
  'GTI', // Atlas Air
  'GEC', // Lufthansa Cargo
  'CLX', // Cargolux
  'BOX', // AeroLogic
  'ABW', // AirBridgeCargo
  'CKS', // Kalitta
  'ATN', // Air Transport International
  'NCA', // Nippon Cargo
  'CAO', // Air China Cargo
  'CKK', // China Cargo
  'CSS', // SF Airlines
  'BCS', // DHL (European Air Transport)
  'DHK', // DHL Air UK
  'TAY', // ASL Airlines Belgium
  'MPH', // Martinair Cargo
  'SQC', // Singapore Airlines Cargo
  'LCO', // LATAM Cargo
  'AZG', // Silk Way West
  'CMB', // Cameo/Challenge? conservative: Challenge Airlines? left in as cargo
  'KYE', // Sky Lease Cargo
]

function callsignMatches(callsign: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    if (
      callsign.startsWith(prefix) &&
      // Require the prefix to be followed by a digit (flight number) or to
      // match the whole callsign — avoids e.g. 'NOW' matching 'NOWAK1'.
      (callsign.length === prefix.length || /\d/.test(callsign[prefix.length] ?? ''))
    ) {
      return true
    }
  }
  return false
}

export function categoryOf(a: Aircraft): AircraftCategory {
  const hex = Number.parseInt(a.icao24, 16)
  if (Number.isFinite(hex)) {
    for (const [lo, hi] of MIL_HEX_RANGES) {
      if (hex >= lo && hex <= hi) return 'military'
    }
  }
  const callsign = a.callsign.trim().toUpperCase()
  if (callsign.length >= 3) {
    if (callsignMatches(callsign, MIL_CALLSIGN_PREFIXES)) return 'military'
    if (callsignMatches(callsign, CARGO_CALLSIGN_PREFIXES)) return 'cargo'
  }
  return 'civil'
}
