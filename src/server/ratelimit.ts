import "server-only";
import { RateLimiter } from "@relay/ratelimit";
import { env } from "@shared/env";

interface Limiters {
  feedback: RateLimiter;
  seedLongChat: RateLimiter;
}

const g = globalThis as unknown as { __cadenceLimiters?: Limiters };

/** Per-IP or per-user windows for the open write endpoints (one process, D1). */
export function getLimiters(): Limiters {
  g.__cadenceLimiters ??= {
    feedback: new RateLimiter(5, 50),
    // The e2e projects share one dev user and each seeds a long chat; the harness is not the abuse case.
    seedLongChat: env.e2e ? new RateLimiter(60, 600) : new RateLimiter(2, 10),
  };
  // Idle keys are dropped every ten minutes, so a day of distinct callers does not pile up in memory.
  const sweeper = setInterval(() => {
    for (const limiter of Object.values(g.__cadenceLimiters!)) limiter.sweep();
  }, 10 * 60 * 1000);
  sweeper.unref();
  return g.__cadenceLimiters;
}

/**
 * The client address as the trusted proxy saw it (#62): with `TRUST_PROXY_HOPS` proxies in front
 * (1 on Railway), the address is that many entries from the right of X-Forwarded-For; the leftmost
 * entry is whatever the client wrote and must never key a limiter.
 */
export function clientIp(request: Request): string {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? (env.isProd ? 1 : 0));
  if (hops > 0) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      const pick = parts[Math.max(0, parts.length - hops)];
      if (pick) return pick;
    }
  }
  return request.headers.get("x-real-ip") ?? "local";
}

export function tooMany(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate_limited", retryAfterMs },
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
  );
}
