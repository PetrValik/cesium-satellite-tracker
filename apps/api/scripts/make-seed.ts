/**
 * Regenerate the committed TLE seed: fetch every curated group from CelesTrak
 * and write seed/<slug>.tle + seed/meta.json. Run with:
 *   npm run seed:make -w apps/api
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCelestrakGroup, parseTleText } from '../src/celestrak.ts'
import { GROUPS } from '../src/groups.ts'

const here = dirname(fileURLToPath(import.meta.url))
const seedDir = join(here, '..', 'seed')
mkdirSync(seedDir, { recursive: true })

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let total = 0
for (const group of GROUPS) {
  const text = await fetchCelestrakGroup(group.celestrakGroup)
  const count = parseTleText(text).length
  if (count === 0) throw new Error(`no TLE records for ${group.slug} — aborting seed`)
  writeFileSync(join(seedDir, `${group.slug}.tle`), text)
  total += count
  console.log(`${group.slug}: ${count} sats`)
  await delay(1_000) // be polite to CelesTrak
}

writeFileSync(
  join(seedDir, 'meta.json'),
  JSON.stringify({ fetchedAt: new Date().toISOString(), totalRecords: total }, null, 2) + '\n',
)
console.log(`seed complete: ${total} TLE records across ${GROUPS.length} groups`)
