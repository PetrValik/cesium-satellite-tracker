import type { Context, Next } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'

export interface RateLimitOptions {
  /** Requests allowed per window per client. */
  limit?: number
  windowMs?: number
  /**
   * Read the client IP from X-Forwarded-For (first hop). Enable ONLY behind
   * a reverse proxy you control — otherwise the header is attacker-supplied.
   */
  trustProxy?: boolean
  now?: () => number
}

/**
 * Fixed-window in-memory per-IP rate limiter. Deliberately simple: the API
 * is a public read-only cache, so the goal is blunting abuse and accidental
 * loops, not precise quota accounting. State resets on restart.
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const limit = options.limit ?? 300
  const windowMs = options.windowMs ?? 60_000
  const trustProxy = options.trustProxy ?? false
  const now = options.now ?? (() => Date.now())

  const buckets = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = 0

  return async (c: Context, next: Next) => {
    const t = now()
    if (t - lastSweep > windowMs) {
      lastSweep = t
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= t) buckets.delete(key)
      }
    }

    let ip = 'unknown'
    if (trustProxy) {
      ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    } else {
      try {
        ip = getConnInfo(c).remote.address ?? 'unknown'
      } catch {
        // non-node runtime (tests via app.request) — everything shares a bucket
      }
    }

    let bucket = buckets.get(ip)
    if (bucket === undefined || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs }
      buckets.set(ip, bucket)
    }
    bucket.count++
    if (bucket.count > limit) {
      c.header('Retry-After', String(Math.ceil((bucket.resetAt - t) / 1000)))
      return c.json({ error: 'rate limit exceeded' }, 429)
    }
    await next()
  }
}
