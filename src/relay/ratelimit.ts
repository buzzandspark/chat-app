// D17: in-memory per-user sliding window, 20 per minute and 300 per day by default.
export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
  remainingMinute: number;
  remainingDay: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private perMinute = 20,
    private perDay = 300,
    private now: () => number = Date.now,
  ) {}

  check(userId: string, consume = true): RateLimitResult {
    const now = this.now();
    const dayAgo = now - 86_400_000;
    const minuteAgo = now - 60_000;
    const list = (this.hits.get(userId) ?? []).filter((t) => t > dayAgo);
    const lastMinute = list.filter((t) => t > minuteAgo);
    const minuteOk = lastMinute.length < this.perMinute;
    const dayOk = list.length < this.perDay;
    let retryAfterMs = 0;
    if (!minuteOk) retryAfterMs = Math.max(retryAfterMs, lastMinute[0]! + 60_000 - now);
    if (!dayOk) retryAfterMs = Math.max(retryAfterMs, list[0]! + 86_400_000 - now);
    const ok = minuteOk && dayOk;
    if (ok && consume) list.push(now);
    this.hits.set(userId, list);
    return {
      ok,
      retryAfterMs,
      remainingMinute: Math.max(0, this.perMinute - lastMinute.length - (ok && consume ? 1 : 0)),
      remainingDay: Math.max(0, this.perDay - list.length),
    };
  }

  reset(userId?: string): void {
    if (userId) this.hits.delete(userId);
    else this.hits.clear();
  }
}
