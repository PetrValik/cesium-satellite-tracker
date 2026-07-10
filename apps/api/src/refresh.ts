import { parseTleText, type TleFetcher } from './celestrak.ts'
import type { Db } from './db.ts'
import { GROUP_BY_SLUG, GROUPS } from './groups.ts'

export const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
export const DEFAULT_FAILURE_COOLDOWN_MS = 60 * 1000

export interface RefresherOptions {
  db: Db
  fetcher: TleFetcher
  ttlMs?: number
  /** Minimum wait before retrying a group whose last refresh failed. */
  failureCooldownMs?: number
  now?: () => number
  log?: (message: string) => void
}

/**
 * Stale-while-revalidate refresh policy per group: requests are served from
 * cache whenever any data exists (stale data kicks off a background refresh);
 * a request only waits on CelesTrak when the cache is completely empty.
 */
export class Refresher {
  private readonly db: Db
  private readonly fetcher: TleFetcher
  private readonly ttlMs: number
  private readonly failureCooldownMs: number
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly failedAt = new Map<string, number>()

  constructor(options: RefresherOptions) {
    this.db = options.db
    this.fetcher = options.fetcher
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.failureCooldownMs = options.failureCooldownMs ?? DEFAULT_FAILURE_COOLDOWN_MS
    this.now = options.now ?? (() => Date.now())
    this.log = options.log ?? ((message) => console.error(message))
  }

  isExpired(slug: string): boolean {
    const meta = this.db.getGroupMeta(slug)
    if (!meta || meta.updatedAt === null) return true
    return this.now() - meta.updatedAt > this.ttlMs
  }

  /** True while a recently failed group is still in its retry cooldown. */
  private inCooldown(slug: string): boolean {
    const failed = this.failedAt.get(slug)
    return failed !== undefined && this.now() - failed < this.failureCooldownMs
  }

  /** Refresh one group from CelesTrak; concurrent calls share one fetch. */
  refresh(slug: string): Promise<void> {
    const existing = this.inflight.get(slug)
    if (existing) return existing
    if (this.inCooldown(slug)) {
      return Promise.reject(new Error(`refresh of ${slug} is cooling down after a failure`))
    }
    const job = this.doRefresh(slug)
      .then(() => {
        this.failedAt.delete(slug)
      })
      .catch((err: unknown) => {
        this.failedAt.set(slug, this.now())
        throw err
      })
      .finally(() => this.inflight.delete(slug))
    this.inflight.set(slug, job)
    return job
  }

  private async doRefresh(slug: string): Promise<void> {
    const def = GROUP_BY_SLUG.get(slug)
    if (!def) throw new Error(`unknown group: ${slug}`)
    const text = await this.fetcher(def.celestrakGroup)
    const sats = parseTleText(text)
    if (sats.length === 0) throw new Error(`CelesTrak returned no TLE records for ${slug}`)
    this.db.replaceGroup(slug, sats, this.now())
  }

  /**
   * Make a group servable. Waits for CelesTrak only when the group is empty;
   * with stale data present it returns immediately and refreshes in the
   * background, swallowing failures (the cache keeps serving stale).
   */
  async ensureFresh(slug: string): Promise<void> {
    if (!this.isExpired(slug)) return
    const meta = this.db.getGroupMeta(slug)
    if (meta && meta.count > 0) {
      this.refresh(slug).catch((err: unknown) => {
        this.log(`[refresh] background refresh of ${slug} failed: ${String(err)}`)
      })
      return
    }
    await this.refresh(slug)
  }

  /** Fire-and-forget refresh of every expired group (cooldowns skipped quietly). */
  refreshExpiredInBackground(): void {
    for (const g of GROUPS) {
      if (this.isExpired(g.slug) && !this.inCooldown(g.slug)) {
        this.refresh(g.slug).catch((err: unknown) => {
          this.log(`[refresh] background refresh of ${g.slug} failed: ${String(err)}`)
        })
      }
    }
  }
}
