/**
 * Automatic retries after a 429: the server's retry-after is the base (15 s default, min 2 s), doubled per attempt,
 * capped at two minutes, four tries in all. The manual "Try again" never waits.
 */
export const MAX_AUTO_RETRIES = 4;

export function rateLimitDelayMs(attempt: number, retryAfterMs: number | undefined): number {
  const base = Math.max(2_000, retryAfterMs ?? 15_000);
  return Math.min(120_000, base * 2 ** Math.max(0, attempt));
}

/** A wait over two minutes (a spent budget) is shown with Try again but never retried automatically. */
export function isLongWait(retryAfterMs: number | undefined): boolean {
  return (retryAfterMs ?? 0) > 120_000;
}

export function waitText(ms: number): string {
  if (ms < 60_000) return "a moment";
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 90 ? `${minutes} min` : `${Math.round(minutes / 60)} hours`;
}

export function busyText(retryAfterMs: number): string {
  return `Busy right now. Try again in ${waitText(retryAfterMs)}.`;
}
