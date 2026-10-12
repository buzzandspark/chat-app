/**
 * Automatic retries after a 429: the server's retry-after is the base (15 s default, min 2 s), doubled per attempt,
 * capped at two minutes, four tries in all. The manual "Try again" never waits.
 */
export const MAX_AUTO_RETRIES = 4;

export function rateLimitDelayMs(attempt: number, retryAfterMs: number | undefined): number {
  const base = Math.max(2_000, retryAfterMs ?? 15_000);
  return Math.min(120_000, base * 2 ** Math.max(0, attempt));
}
