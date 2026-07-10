/** Curated CelesTrak GP groups served by the cache. */
export interface GroupDef {
  /** Our URL slug (lowercase). */
  slug: string
  /** CelesTrak GROUP= query value (case-sensitive on their side). */
  celestrakGroup: string
  /** Display name. */
  name: string
}

export const GROUPS: GroupDef[] = [
  { slug: 'stations', celestrakGroup: 'stations', name: 'Space stations' },
  { slug: 'last-30-days', celestrakGroup: 'last-30-days', name: 'Recent launches' },
  { slug: 'starlink', celestrakGroup: 'starlink', name: 'Starlink' },
  { slug: 'oneweb', celestrakGroup: 'oneweb', name: 'OneWeb' },
  { slug: 'iridium-next', celestrakGroup: 'iridium-NEXT', name: 'Iridium NEXT' },
  { slug: 'gps-ops', celestrakGroup: 'gps-ops', name: 'GPS' },
  { slug: 'galileo', celestrakGroup: 'galileo', name: 'Galileo' },
  { slug: 'glo-ops', celestrakGroup: 'glo-ops', name: 'GLONASS' },
  { slug: 'beidou', celestrakGroup: 'beidou', name: 'BeiDou' },
  { slug: 'weather', celestrakGroup: 'weather', name: 'Weather' },
  { slug: 'geo', celestrakGroup: 'geo', name: 'Geosynchronous' },
  { slug: 'science', celestrakGroup: 'science', name: 'Science' },
]

export const GROUP_BY_SLUG = new Map(GROUPS.map((g) => [g.slug, g]))
