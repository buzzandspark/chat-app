import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import { costOf, ratesFor } from "./anthropic/pricing";
import { MAX_TOKENS } from "./anthropic/thinking-config";

export class QuotaExceededError extends Error {
  constructor(
    public spentUsd: number,
    public capUsd: number,
  ) {
    super("quota_exceeded");
    this.name = "QuotaExceededError";
  }
}

// D22: a reservation (input estimate plus max_tokens at the output rate) is held in memory on send so
// two concurrent sends cannot both pass; settle() releases it and adds the real or estimated cost.
export class QuotaManager {
  private reserved = new Map<string, number>();
  constructor(private db: Db) {}

  reserve(userId: string, generationId: string, model: string, estimatedInputTokens: number): void {
    const user = this.db
      .select({ cap: users.costCapUsd, spent: users.costSpentUsd })
      .from(users)
      .where(eq(users.id, userId))
      .get();
    if (!user || user.cap === null) return;
    const estimate = costOf(model, {
      inputTokens: estimatedInputTokens,
      outputTokens: MAX_TOKENS,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // Atomic in a single-threaded process: the sum and the insert happen in one tick.
    let outstanding = 0;
    for (const [key, value] of this.reserved) if (key.startsWith(`${userId}:`)) outstanding += value;
    if (user.spent + outstanding + estimate > user.cap) {
      throw new QuotaExceededError(user.spent, user.cap);
    }
    this.reserved.set(`${userId}:${generationId}`, estimate);
  }

  release(userId: string, generationId: string): void {
    this.reserved.delete(`${userId}:${generationId}`);
  }

  settle(userId: string, generationId: string, costUsd: number): void {
    this.release(userId, generationId);
    if (costUsd <= 0) return;
    this.db
      .update(users)
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
