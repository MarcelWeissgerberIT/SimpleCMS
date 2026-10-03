/**
 * In-memory sliding-window limiter (one process serves one deployment, so no shared store is needed).
 * Keys look like "auth:ip:1.2.3.4" or "auth:email:a@b.c".
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly timer: NodeJS.Timeout

  constructor() {
    this.timer = setInterval(() => this.prune(), 60_000)
    this.timer.unref()
  }

  /** Records a hit and returns how long to wait (seconds) when the limit is exceeded, or 0 when allowed. */
  hit(key: string, limit: number, windowMs: number): number {
    const now = Date.now()
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - windowMs)
    if (list.length >= limit) {
      this.hits.set(key, list)
      return Math.max(1, Math.ceil(((list[0] ?? now) + windowMs - now) / 1000))
    }
    list.push(now)
    this.hits.set(key, list)
    return 0
  }

  private prune() {
    const cutoff = Date.now() - 24 * 60 * 60_000
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff)
      if (kept.length) this.hits.set(key, kept)
      else this.hits.delete(key)
    }
  }

  stop() {
    clearInterval(this.timer)
  }
}
