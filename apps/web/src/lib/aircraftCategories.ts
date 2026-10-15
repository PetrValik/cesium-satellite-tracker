/**
 * The aircraft category list — the one spelling of it. Lives in lib/ (like
 * ORBIT_CLASSES in lib/protocol) so core/ui's colour prefs and the airspace
 * slice key off the same list; the classification itself stays in
 * features/airspace/aircraftCategory.
 */
export const AIRCRAFT_CATEGORIES = ['civil', 'cargo', 'military'] as const
export type AircraftCategory = (typeof AIRCRAFT_CATEGORIES)[number]
