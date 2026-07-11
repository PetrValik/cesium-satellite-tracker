import { describe, expect, it } from 'vitest'
import { parseTleText, type ParsedTle } from '../src/satellites/celestrak.ts'
import { Db } from '../src/satellites/db.ts'
import { GROUPS } from '../src/satellites/groups.ts'
import { T0, tleFor } from './helpers.ts'

function sat(noradId: number, name: string): ParsedTle {
  return parseTleText(tleFor(noradId, name))[0]!
}

function freshDb(): Db {
  const db = new Db(':memory:')
  db.ensureGroups(GROUPS)
  return db
}

describe('Db.replaceGroup', () => {
  it('deletes a satellite orphaned by leaving its only group but keeps multi-group ones', () => {
    const db = freshDb()
    db.replaceGroup('stations', [sat(100, 'ALPHA'), sat(200, 'BETA')], T0)
    db.replaceGroup('science', [sat(200, 'BETA'), sat(300, 'GAMMA')], T0)

    // BETA leaves stations but survives through its science membership
    db.replaceGroup('stations', [sat(100, 'ALPHA')], T0 + 1)
    expect(db.getSatellite(200)?.groups).toEqual(['science'])
    expect(db.getGroupSatellites('stations').map((s) => s.noradId)).toEqual([100])

    // BETA leaves science too — now orphaned and removed entirely
    db.replaceGroup('science', [sat(300, 'GAMMA')], T0 + 2)
    expect(db.getSatellite(200)).toBeUndefined()
    expect(db.counts().satCount).toBe(2)
  })

  it('upserts an existing satellite TLE in place on refresh', () => {
    const db = freshDb()
    db.replaceGroup('stations', [sat(25544, 'ISS (ZARYA)')], T0)

    const updated = sat(25544, 'ISS (RENAMED)')
    updated.tle1 = updated.tle1.replace('08264.51782528', '09001.50000000')
    db.replaceGroup('stations', [updated], T0 + 1)

    const iss = db.getSatellite(25544)!
    expect(iss.name).toBe('ISS (RENAMED)')
    expect(iss.tle1).toContain('09001.50000000')
    expect(iss.groups).toEqual(['stations'])
    expect(db.counts().satCount).toBe(1)
    expect(db.getGroupMeta('stations')?.updatedAt).toBe(T0 + 1)
  })
})

describe('Db.search', () => {
  it('caps results at the limit, keeping name order', () => {
    const db = freshDb()
    db.replaceGroup(
      'stations',
      [1, 2, 3, 4, 5].map((i) => sat(1000 + i, `NODE ${i}`)),
      T0,
    )

    const capped = db.search('NODE', 3)
    expect(capped.map((s) => s.name)).toEqual(['NODE 1', 'NODE 2', 'NODE 3'])
    expect(db.search('NODE', 10)).toHaveLength(5)
  })
})

describe('Db.counts', () => {
  it('reports zero for a brand-new database', () => {
    expect(new Db(':memory:').counts()).toEqual({ satCount: 0, groups: 0 })
  })

  it('counts registered groups and distinct satellites', () => {
    const db = freshDb()
    expect(db.counts()).toEqual({ satCount: 0, groups: GROUPS.length })

    db.replaceGroup('stations', [sat(1, 'A'), sat(2, 'B')], T0)
    db.replaceGroup('science', [sat(2, 'B')], T0)
    expect(db.counts()).toEqual({ satCount: 2, groups: GROUPS.length })
  })
})
