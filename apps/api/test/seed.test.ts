import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Db } from '../src/db.ts'
import { GROUPS } from '../src/groups.ts'
import { loadSeed } from '../src/seed.ts'
import { tleFor } from './helpers.ts'

describe('loadSeed', () => {
  let dir: string

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads committed snapshot files and keeps the seed timestamp', () => {
    dir = mkdtempSync(join(tmpdir(), 'orbital-seed-'))
    writeFileSync(join(dir, 'stations.tle'), tleFor(25544, 'ISS (ZARYA)'))
    writeFileSync(join(dir, 'gps-ops.tle'), tleFor(24876, 'GPS BIIR-2'))
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ fetchedAt: '2026-07-01T00:00:00.000Z' }),
    )

    const db = new Db(':memory:')
    db.ensureGroups(GROUPS)
    expect(loadSeed(db, dir)).toBe(2)
    expect(db.counts().satCount).toBe(2)
    expect(db.getGroupMeta('stations')?.updatedAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'))
    expect(db.getGroupMeta('starlink')?.updatedAt).toBeNull()
  })

  it('is a no-op for missing files and empty payloads', () => {
    dir = mkdtempSync(join(tmpdir(), 'orbital-seed-'))
    writeFileSync(join(dir, 'stations.tle'), 'No GP data found\n')
    const db = new Db(':memory:')
    db.ensureGroups(GROUPS)
    expect(loadSeed(db, dir)).toBe(0)
    expect(db.counts().satCount).toBe(0)
  })
})
