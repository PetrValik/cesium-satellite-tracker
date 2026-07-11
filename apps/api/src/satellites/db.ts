/**
 * SQLite TLE cache (node:sqlite — built into Node ≥22.5, zero native deps).
 * Satellites are unique by NORAD id with the newest TLE winning; group
 * membership is a separate table so one satellite can sit in many groups.
 * All statements are parameterized; LIKE inputs are escaped here, never in
 * route code.
 */
import { DatabaseSync } from 'node:sqlite'
import type { Satellite } from '@orbital-ops/shared'
import type { ParsedTle } from './celestrak.ts'
import type { GroupDef } from './groups.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  slug       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at INTEGER            -- ms epoch of last successful refresh; NULL = never
);
CREATE TABLE IF NOT EXISTS satellites (
  norad_id   INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  tle1       TEXT NOT NULL,
  tle2       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  group_slug TEXT NOT NULL REFERENCES groups(slug),
  norad_id   INTEGER NOT NULL REFERENCES satellites(norad_id),
  PRIMARY KEY (group_slug, norad_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_norad ON memberships(norad_id);
CREATE INDEX IF NOT EXISTS idx_satellites_name ON satellites(name);
`

export interface GroupMeta {
  slug: string
  name: string
  count: number
  /** ms epoch or null when the group has never been refreshed. */
  updatedAt: number | null
}

interface SatRow {
  norad_id: number
  name: string
  tle1: string
  tle2: string
  groups_csv: string | null
}

function toSatellite(row: SatRow): Satellite {
  return {
    noradId: row.norad_id,
    name: row.name,
    tle1: row.tle1,
    tle2: row.tle2,
    groups: row.groups_csv ? row.groups_csv.split(',').sort() : [],
  }
}

const SAT_SELECT = `
  s.norad_id, s.name, s.tle1, s.tle2,
  (SELECT GROUP_CONCAT(m2.group_slug) FROM memberships m2 WHERE m2.norad_id = s.norad_id) AS groups_csv
`

export class Db {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  /** Register curated groups; keeps definition order for listing. */
  ensureGroups(groups: GroupDef[]): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO groups (slug, name) VALUES (?, ?)')
    for (const g of groups) stmt.run(g.slug, g.name)
  }

  /** Atomically replace one group's membership and upsert its TLEs. */
  replaceGroup(slug: string, sats: ParsedTle[], updatedAt: number): void {
    const upsertSat = this.db.prepare(`
      INSERT INTO satellites (norad_id, name, tle1, tle2, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(norad_id) DO UPDATE SET
        name = excluded.name, tle1 = excluded.tle1,
        tle2 = excluded.tle2, updated_at = excluded.updated_at
    `)
    const insertMembership = this.db.prepare(
      'INSERT OR IGNORE INTO memberships (group_slug, norad_id) VALUES (?, ?)',
    )
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM memberships WHERE group_slug = ?').run(slug)
      for (const sat of sats) {
        upsertSat.run(sat.noradId, sat.name, sat.tle1, sat.tle2, updatedAt)
        insertMembership.run(slug, sat.noradId)
      }
      this.db
        .prepare('DELETE FROM satellites WHERE norad_id NOT IN (SELECT norad_id FROM memberships)')
        .run()
      this.db.prepare('UPDATE groups SET updated_at = ? WHERE slug = ?').run(updatedAt, slug)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  getGroupMeta(slug: string): GroupMeta | undefined {
    const row = this.db
      .prepare(
        `SELECT g.slug, g.name, g.updated_at,
           (SELECT COUNT(*) FROM memberships m WHERE m.group_slug = g.slug) AS count
         FROM groups g WHERE g.slug = ?`,
      )
      .get(slug) as { slug: string; name: string; updated_at: number | null; count: number } | undefined
    if (!row) return undefined
    return { slug: row.slug, name: row.name, count: row.count, updatedAt: row.updated_at }
  }

  listGroups(): GroupMeta[] {
    const rows = this.db
      .prepare(
        `SELECT g.slug, g.name, g.updated_at,
           (SELECT COUNT(*) FROM memberships m WHERE m.group_slug = g.slug) AS count
         FROM groups g ORDER BY g.rowid`,
      )
      .all() as unknown as { slug: string; name: string; updated_at: number | null; count: number }[]
    return rows.map((r) => ({ slug: r.slug, name: r.name, count: r.count, updatedAt: r.updated_at }))
  }

  getGroupSatellites(slug: string): Satellite[] {
    const rows = this.db
      .prepare(
        `SELECT ${SAT_SELECT}
         FROM satellites s
         JOIN memberships m ON m.norad_id = s.norad_id
         WHERE m.group_slug = ?
         ORDER BY s.name`,
      )
      .all(slug) as unknown as SatRow[]
    return rows.map(toSatellite)
  }

  /** Case-insensitive name substring or NORAD-id prefix match. */
  search(q: string, limit: number): Satellite[] {
    const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    const rows = this.db
      .prepare(
        `SELECT ${SAT_SELECT}
         FROM satellites s
         WHERE s.name LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR CAST(s.norad_id AS TEXT) LIKE ? ESCAPE '\\'
         ORDER BY s.name LIMIT ?`,
      )
      .all(`%${escaped}%`, `${escaped}%`, limit) as unknown as SatRow[]
    return rows.map(toSatellite)
  }

  getSatellite(noradId: number): Satellite | undefined {
    const row = this.db
      .prepare(`SELECT ${SAT_SELECT} FROM satellites s WHERE s.norad_id = ?`)
      .get(noradId) as SatRow | undefined
    return row ? toSatellite(row) : undefined
  }

  counts(): { satCount: number; groups: number } {
    const sats = this.db.prepare('SELECT COUNT(*) AS n FROM satellites').get() as { n: number }
    const groups = this.db.prepare('SELECT COUNT(*) AS n FROM groups').get() as { n: number }
    return { satCount: sats.n, groups: groups.n }
  }

  close(): void {
    this.db.close()
  }
}
