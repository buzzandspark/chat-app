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
  return g.__cadenceLimiters;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export function tooMany(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate_limited", retryAfterMs },
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
  );
}
