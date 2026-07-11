import { describe, expect, it, vi } from 'vitest'
import type { TleFetcher } from '../src/satellites/celestrak.ts'
import { Db } from '../src/satellites/db.ts'
import { GROUPS } from '../src/satellites/groups.ts'
import {
  DEFAULT_FAILURE_COOLDOWN_MS,
  DEFAULT_TTL_MS,
  Refresher,
} from '../src/satellites/refresh.ts'
import { failingFetcher, T0, tleFor } from './helpers.ts'

function refresherEnv(fetcher: TleFetcher) {
  const db = new Db(':memory:')
  db.ensureGroups(GROUPS)
  let clock = T0
  const refresher = new Refresher({ db, fetcher, now: () => clock, log: () => {} })
  return {
    refresher,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('Refresher.refresh cooldown', () => {
  it('rejects while a failed group is cooling down, then retries once it elapses', async () => {
    const fetcher = failingFetcher()
    const { refresher, advance } = refresherEnv(fetcher)

    await expect(refresher.refresh('stations')).rejects.toThrow('CelesTrak unreachable')
    await expect(refresher.refresh('stations')).rejects.toThrow(/cooling down/)
    expect(fetcher).toHaveBeenCalledTimes(1) // the cooldown rejection never hit CelesTrak

    advance(DEFAULT_FAILURE_COOLDOWN_MS + 1)
    await expect(refresher.refresh('stations')).rejects.toThrow('CelesTrak unreachable')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('scopes the cooldown to the group that failed', async () => {
    const fetcher = vi.fn(async (group: string) => {
      if (group === 'stations') throw new Error('boom')
      return tleFor(20580, 'HST')
    })
    const { refresher } = refresherEnv(fetcher)

    await expect(refresher.refresh('stations')).rejects.toThrow('boom')
    await expect(refresher.refresh('science')).resolves.toBeUndefined()
  })
})

describe('Refresher.isExpired', () => {
  it('treats never-refreshed and unknown groups as expired', () => {
    const { refresher } = refresherEnv(failingFetcher())
    expect(refresher.isExpired('stations')).toBe(true)
    expect(refresher.isExpired('no-such-group')).toBe(true)
  })

  it('turns false after a successful refresh and true again once the TTL passes', async () => {
    const { refresher, advance } = refresherEnv(vi.fn(async () => tleFor(25544, 'ISS (ZARYA)')))

    await refresher.refresh('stations')
    expect(refresher.isExpired('stations')).toBe(false)

    advance(DEFAULT_TTL_MS) // exactly at the TTL is still fresh
    expect(refresher.isExpired('stations')).toBe(false)

    advance(1)
    expect(refresher.isExpired('stations')).toBe(true)
  })
})
