import type { Engine, StartInput, StartOutcome } from "./engine";
import type { RateLimiter } from "./ratelimit";

/** One client cannot hold the process with parallel generations (#62). */
export const MAX_RUNNING_PER_USER = 3;

export interface Refusal {
  retryAfterMs: number;
}

export type AdmittedOutcome = StartOutcome | { created: false; reason: "rate_limited"; retryAfterMs: number };

/** The per-user window (D17), then the running cap; check-only, nothing is charged. */
export function admissionRefusal(
  engine: Pick<Engine, "runningFor">,
  limiter: RateLimiter,
  userId: string,
  maxRunning = MAX_RUNNING_PER_USER,
): Refusal | null {
  const limit = limiter.check(userId, false);
  if (!limit.ok) return { retryAfterMs: limit.retryAfterMs };
  if (engine.runningFor(userId) >= maxRunning) return { retryAfterMs: 2000 };
  return null;
}

/**
 * Admit, start and charge in one synchronous step. A check made before an await is only advisory:
 * N regenerates that all wait on the same `stopAndWait` would each pass it and then all start, past
 * both the window and the cap. With no await between the check and `engine.start`, every start
 * counts toward the next request's check. An id that already exists is never refused: that is a
 * duplicate POST (or a concurrent one that won the race), and `start` answers it with `exists`.
 */
export function startAdmitted(
  engine: Pick<Engine, "runningFor" | "owner" | "start">,
  limiter: RateLimiter,
  input: StartInput,
  maxRunning = MAX_RUNNING_PER_USER,
): AdmittedOutcome {
  if (engine.owner(input.generationId) === null) {
    const refusal = admissionRefusal(engine, limiter, input.userId, maxRunning);
    if (refusal) return { created: false, reason: "rate_limited", retryAfterMs: refusal.retryAfterMs };
  }
  const outcome = engine.start(input);
  if (outcome.created) limiter.check(input.userId, true);
  return outcome;
}
