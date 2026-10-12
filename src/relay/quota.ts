import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import { ratesFor } from "./anthropic/pricing";

export class QuotaExceededError extends Error {
  constructor(
    public spentUsd: number,
    public capUsd: number,
  ) {
    super("quota_exceeded");
    this.name = "QuotaExceededError";
  }
}

interface Meter {
  userId: string;
  inputUsd: number;
  /** USD per million output tokens, at the tier the prompt falls in. */
  outputRate: number;
  chars: number;
}

// D22 (amended 2026-10-12): a reply starts while its estimated input still fits under the cap, and is
// metered while it streams (input at the start, output from the streamed text at chars / 4). Once spend
// plus every live meter of the user reaches the cap, the engine stops all of that user's replies. The
// settled cost (real usage) replaces the meter, so the cap can be overshot by about one delta per stream.
export class QuotaManager {
  private meters = new Map<string, Meter>();
  constructor(private db: Db) {}

  private capOf(userId: string): { cap: number | null; spent: number } | undefined {
    return this.db.select({ cap: users.costCapUsd, spent: users.costSpentUsd }).from(users).where(eq(users.id, userId)).get();
  }

  private liveUsd(userId: string): number {
    let usd = 0;
    for (const m of this.meters.values()) {
      if (m.userId === userId) usd += m.inputUsd + (Math.ceil(m.chars / 4) * m.outputRate) / 1_000_000;
    }
    return usd;
  }

  admit(userId: string, generationId: string, model: string, estimatedInputTokens: number): void {
    const user = this.capOf(userId);
    if (!user || user.cap === null) return;
    const rates = ratesFor(model, estimatedInputTokens);
    const inputUsd = (estimatedInputTokens * rates.input) / 1_000_000;
    // Atomic in a single-threaded process: the sum and the insert happen in one tick.
    if (user.spent + this.liveUsd(userId) + inputUsd > user.cap) throw new QuotaExceededError(user.spent, user.cap);
    this.meters.set(generationId, { userId, inputUsd, outputRate: rates.output, chars: 0 });
  }

  /** Counts streamed text (reply or thinking); true once the user's spend and live replies reach the cap. */
  meter(generationId: string, chars: number): boolean {
    const m = this.meters.get(generationId);
    if (!m) return false;
    m.chars += chars;
    const user = this.capOf(m.userId);
    return user !== undefined && user.cap !== null && user.spent + this.liveUsd(m.userId) >= user.cap;
  }

  release(_userId: string, generationId: string): void {
    this.meters.delete(generationId);
  }

  settle(userId: string, generationId: string, costUsd: number): void {
    this.release(userId, generationId);
    if (costUsd <= 0) return;
    QuotaManager.addSpend(this.db, userId, costUsd);
  }

  /** The spend increment on its own, so the engine can run it inside its final transaction (finding 6). */
  static addSpend(db: Pick<Db, "update">, userId: string, costUsd: number): void {
    if (costUsd <= 0) return;
    db.update(users)
      .set({ costSpentUsd: sql`${users.costSpentUsd} + ${costUsd}` })
      .where(eq(users.id, userId))
      .run();
  }

  /** Rough reservation input: chars / 4 is a safe over-estimate for English prose. */
  static estimateInputTokens(chars: number): number {
    return Math.ceil(chars / 4) + 200;
  }

  static outputRate(model: string): number {
    return ratesFor(model).output;
  }
}
