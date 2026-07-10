import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTleText } from './celestrak.ts'
import type { Db } from './db.ts'
import { GROUPS } from './groups.ts'

/**
 * Load the committed TLE snapshot (seed/<slug>.tle + meta.json) into an empty
 * cache so the app works offline. The seed's fetch timestamp is kept as
 * updated_at, so seeded groups count as stale and refresh on first use.
 */
export function loadSeed(db: Db, seedDir: string): number {
  let fetchedAt = 0
  const metaPath = join(seedDir, 'meta.json')
  if (existsSync(metaPath)) {
    const parsed = Date.parse(JSON.parse(readFileSync(metaPath, 'utf8')).fetchedAt)
    if (Number.isFinite(parsed)) fetchedAt = parsed
  }

  let total = 0
  for (const group of GROUPS) {
    const tlePath = join(seedDir, `${group.slug}.tle`)
    if (!existsSync(tlePath)) continue
    const sats = parseTleText(readFileSync(tlePath, 'utf8'))
    if (sats.length === 0) continue
    db.replaceGroup(group.slug, sats, fetchedAt)
    total += sats.length
  }
  return total
}
