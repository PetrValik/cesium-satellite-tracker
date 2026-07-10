import { Hono } from 'hono'

/**
 * Hono app factory. Placeholder until the TLE cache lands: dependencies
 * (db, fetcher) will be injected here so tests can run against a temp DB.
 */
export function createApp() {
  const app = new Hono()

  app.get('/api/health', (c) => c.json({ ok: true, satCount: 0, groups: 0 }))

  return app
}
