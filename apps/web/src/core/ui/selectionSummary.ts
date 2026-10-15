/**
 * One selection condensed for the compact-HUD chip: what it is, its name and
 * one key value. Each domain slice formats its own (the same formatters its
 * detail panel uses); app/SelectionChip only picks the focused mode's.
 */
export interface SelectionSummary {
  /** Short kind tag: SAT / VSL / ACFT. */
  kind: string
  name: string
  /** Label of the one live value (ALT, SOG…). */
  key: string
  value: string
}
