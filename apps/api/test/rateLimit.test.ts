import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { Db } from '../src/satellites/db.ts'
import { GROUPS } from '../src/satellites/groups.ts'
import { Refresher } from '../src/satellites/refresh.ts'
import type { RateLimitOptions } from '../src/shared/rateLimit.ts'
import { failingFetcher, T0 } from './helpers.ts'

/** App wired like production but with a controllable clock and limiter config. */
function limitedEnv(options: Omit<RateLimitOptions, 'now'>) {
  let clock = T0
  const db = new Db(':memory:')
  db.ensureGroups(GROUPS)
  const refresher = new Refresher({ db, fetcher: failingFetcher(), now: () => clock, log: () => {} })
  const app = createApp({ db, refresher, rateLimit: { ...options, now: () => clock } })
  return {
    app,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } })

describe('rateLimit middleware', () => {
  it('keeps a separate bucket per X-Forwarded-For IP when trustProxy is on', async () => {
    const { app } = limitedEnv({ limit: 2, windowMs: 60_000, trustProxy: true })

    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(200)
    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(200)
    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(429)

    // other clients are unaffected...
    expect((await app.request('/api/health', from('2.2.2.2'))).status).toBe(200)
    // ...and so are requests without the header (the 'unknown' bucket)
    expect((await app.request('/api/health')).status).toBe(200)
  })

  it('uses the first hop of a multi-proxy X-Forwarded-For chain', async () => {
    const { app } = limitedEnv({ limit: 1, windowMs: 60_000, trustProxy: true })

    expect((await app.request('/api/health', from('1.1.1.1, 10.0.0.1'))).status).toBe(200)

    // same client arriving via a different proxy chain shares the bucket
    const blocked = await app.request('/api/health', from('1.1.1.1, 10.9.9.9'))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('60')
  })

  it('ignores X-Forwarded-For when trustProxy is off', async () => {
    const { app } = limitedEnv({ limit: 2, windowMs: 60_000, trustProxy: false })

    // app.request carries no socket info, so every client lands in one shared
    // 'unknown' bucket — attacker-supplied headers cannot mint fresh quota.
    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(200)
    expect((await app.request('/api/health', from('2.2.2.2'))).status).toBe(200)
    expect((await app.request('/api/health', from('3.3.3.3'))).status).toBe(429)
  })

  it('resets a bucket once its window expires', async () => {
    const { app, advance } = limitedEnv({ limit: 1, windowMs: 60_000, trustProxy: true })

    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(200)
    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(429)

    advance(60_001)
    expect((await app.request('/api/health', from('1.1.1.1'))).status).toBe(200)
  })
})
