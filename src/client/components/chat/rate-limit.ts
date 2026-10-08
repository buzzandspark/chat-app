/**
 * Automatic retries after a 429: the server's retry-after is the base (15 s when it gives none, never
 * under 2 s), doubled for each attempt already made, capped at two minutes, four automatic tries in all.
 * The manual "Try again" is always there and does not wait.
 */
export const MAX_AUTO_RETRIES = 4;

export function rateLimitDelayMs(attempt: number, retryAfterMs: number | undefined): number {
  const base = Math.max(2_000, retryAfterMs ?? 15_000);
  return Math.min(120_000, base * 2 ** Math.max(0, attempt));
}
