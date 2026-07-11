import { vi } from 'vitest'
import type { TleFetcher } from '../src/satellites/celestrak.ts'
import { Db } from '../src/satellites/db.ts'
import { GROUPS } from '../src/satellites/groups.ts'
import { Refresher } from '../src/satellites/refresh.ts'
import { createApp } from '../src/app.ts'

// Canonical ISS TLE (69-char lines); tleFor splices a different id into cols 3–7.
export const T1 = '1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927'
export const T2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537'

/** Build a 3-line TLE entry for a synthetic satellite. */
export function tleFor(noradId: number, name: string): string {
  const id = String(noradId).padStart(5, '0')
  return `${name}\n${T1.slice(0, 2)}${id}${T1.slice(7)}\n${T2.slice(0, 2)}${id}${T2.slice(7)}\n`
}

export const T0 = 1_750_000_000_000

/** App + in-memory DB + fake clock, wired the same way as production. */
export function testEnv(fetcher: TleFetcher) {
  const db = new Db(':memory:')
  db.ensureGroups(GROUPS)
  let clock = T0
  const refresher = new Refresher({ db, fetcher, now: () => clock, log: () => {} })
  const app = createApp({ db, refresher })
  return {
    db,
    app,
    refresher,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

export function failingFetcher(): TleFetcher {
  return vi.fn(async () => {
    throw new Error('CelesTrak unreachable')
  })
}
