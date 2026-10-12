import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import { costOf, ratesFor, type TokenCounts } from "./anthropic/pricing";

/** Characters per token as measured on real prompts and replies, code and thinking included. */
export const CHARS_PER_TOKEN = 2.5;

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

// A reply starts while its estimated input fits under the cap; message_start swaps in the exact input cost and output is metered as it streams.
// Once spend plus the user's live meters reach the cap, all their replies stop. Settled cost replaces the meter, so the cap can overshoot by about one delta per stream.
export class QuotaManager {
  private meters = new Map<string, Meter>();
  constructor(private db: Db) {}

  private capOf(userId: string): { cap: number | null; spent: number } | undefined {
    return this.db.select({ cap: users.costCapUsd, spent: users.costSpentUsd }).from(users).where(eq(users.id, userId)).get();
  }

  private liveUsd(userId: string): number {
    let usd = 0;
    for (const m of this.meters.values()) {
      if (m.userId === userId) usd += m.inputUsd + (Math.ceil(m.chars / CHARS_PER_TOKEN) * m.outputRate) / 1_000_000;
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

  /** The prompt as message_start billed it, cache writes and the long-context tier included. */
  started(generationId: string, model: string, usage: Omit<TokenCounts, "outputTokens">): void {
    const m = this.meters.get(generationId);
    if (!m) return;
    m.inputUsd = costOf(model, { ...usage, outputTokens: 0 });
    m.outputRate = ratesFor(model, usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens).output;
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

  /** The spend increment on its own, so the engine can run it inside its final transaction. */
  static addSpend(db: Pick<Db, "update">, userId: string, costUsd: number): void {
    if (costUsd <= 0) return;
    db.update(users)
      .set({ costSpentUsd: sql`${users.costSpentUsd} + ${costUsd}` })
      .where(eq(users.id, userId))
      .run();
  }

  /** For admission only: message_start replaces it with the billed count. */
  static estimateInputTokens(chars: number): number {
    return Math.ceil(chars / CHARS_PER_TOKEN) + 100;
  }

  static outputRate(model: string): number {
    return ratesFor(model).output;
  }
}
