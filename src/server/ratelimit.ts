import "server-only";
import { RateLimiter } from "@relay/ratelimit";
import { env } from "@shared/env";

interface Limiters {
  seedLongChat: RateLimiter;
  guestStart: RateLimiter;
  guestStartAll: RateLimiter;
}

const g = globalThis as unknown as { __chatLimiters?: Limiters };

/** Per-IP or per-user windows for the open write endpoints (in memory: one process). */
export function getLimiters(): Limiters {
  if (g.__chatLimiters) return g.__chatLimiters;
  const limiters: Limiters = {
    // The e2e projects share one dev user and each seeds a long chat; the harness is not the abuse case.
    seedLongChat: env.e2e ? new RateLimiter(60, 600) : new RateLimiter(2, 10),
    // New guests per address: clearing cookies must not hand out a fresh allowance every time.
    guestStart: env.e2e ? new RateLimiter(60, 600) : new RateLimiter(3, 20),
    // And across every address, a ceiling on new guests a day (each can spend up to the guest cap).
    guestStartAll: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(30, 500),
  };
  // Idle keys are dropped every ten minutes, so a day of distinct callers does not pile up in memory.
  // Started here, once with the limiters, not per call: a timer per request would never be cleared.
  for (const limiter of Object.values(limiters)) limiter.startSweeper();
  g.__chatLimiters = limiters;
  return limiters;
}

/**
 * The client address as the trusted proxy saw it: `TRUST_PROXY_HOPS` entries from the right of X-Forwarded-For
 * (1 on Railway). The leftmost entry is whatever the client wrote and must never key a limiter.
 */
export function clientIp(request: Request): string {
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? (env.isProd ? 1 : 0));
  // Without a trusted proxy every forwarding header is the client's own word: one shared key then.
  if (hops <= 0) return "local";
  const forwarded = request.headers.get("x-forwarded-for");
  const parts = (forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts[Math.max(0, parts.length - hops)] ?? "local";
  // An IPv6 client usually holds a whole /64: key by that prefix, not by each address in it.
  return ip.includes(":") ? `${ip.split(":").slice(0, 4).join(":")}::/64` : ip;
}

export function tooMany(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate_limited", retryAfterMs },
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
  );
}
