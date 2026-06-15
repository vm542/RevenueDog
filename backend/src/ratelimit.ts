/**
 * Minimal in-memory fixed-window rate limiter (per process). Good enough to blunt abuse
 * and runaway clients on a single instance; for a multi-instance deployment, back this
 * with a shared store (e.g. Redis). A limit of 0 disables limiting.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Returns true if the request is allowed; false if the caller has exceeded the limit. */
  check(key: string, now = Date.now()): boolean {
    if (this.limit <= 0) return true;
    const entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Drops expired windows; call periodically to bound memory. */
  sweep(now = Date.now()): void {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
  }
}
