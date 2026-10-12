import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import type { UserRole } from "@shared/types";
import { costOf, ratesFor, type TokenCounts } from "./anthropic/pricing";
import { ALL_GUESTS, type Budgets } from "./budgets";

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

export class PromptTooLongError extends Error {
  constructor(
    public tokens: number,
    public maxTokens: number,
  ) {
    super("context_full");
    this.name = "PromptTooLongError";
  }
}

/** A budget the guest shares (its address, its /48, every guest) is spent; it refills in `retryAfterMs`. */
export class BudgetExceededError extends Error {
  constructor(public retryAfterMs: number) {
    super("rate_limited");
    this.name = "BudgetExceededError";
  }
}

export interface GuestLimits {
  /** Estimated prompt tokens a guest may send. */
  maxPromptTokens: number;
  budgets: Budgets;
}

/** The database or a transaction on it. */
export type SpendDb = Pick<Db, "select" | "insert" | "update">;

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
  constructor(
    private db: Db,
    private guests: GuestLimits | null = null,
  ) {}

  private account(db: Pick<Db, "select">, userId: string) {
    return db
      .select({ cap: users.costCapUsd, spent: users.costSpentUsd, role: users.role, budgetKeys: users.budgetKeys })
      .from(users)
      .where(eq(users.id, userId))
      .get();
  }

  /** A guest is charged to the budgets of the address that created it and to the one every guest shares. */
  private budgetKeys(user: { role: UserRole; budgetKeys: string[] | null }): string[] {
    return user.role === "guest" ? [...(user.budgetKeys ?? []), ALL_GUESTS] : [];
  }

  private liveUsd(userId: string): number {
    let usd = 0;
    for (const m of this.meters.values()) {
      if (m.userId === userId) usd += m.inputUsd + (Math.ceil(m.chars / CHARS_PER_TOKEN) * m.outputRate) / 1_000_000;
    }
    return usd;
  }

  /** Refuses a guest's oversized prompt, then a reply over the user's cap, then one from a guest whose budgets are spent. */
  admit(userId: string, generationId: string, model: string, estimatedInputTokens: number): void {
    const user = this.account(this.db, userId);
    if (!user) return;
    if (this.guests && user.role === "guest" && estimatedInputTokens > this.guests.maxPromptTokens) {
      throw new PromptTooLongError(estimatedInputTokens, this.guests.maxPromptTokens);
    }
    const rates = ratesFor(model, estimatedInputTokens);
    const inputUsd = (estimatedInputTokens * rates.input) / 1_000_000;
    // Atomic in a single-threaded process: the sum and the insert happen in one tick.
    if (user.cap !== null && user.spent + this.liveUsd(userId) + inputUsd > user.cap) throw new QuotaExceededError(user.spent, user.cap);
    const waitMs = this.guests?.budgets.check(this.budgetKeys(user)) ?? null;
    if (waitMs !== null) throw new BudgetExceededError(waitMs);
    if (user.cap !== null) this.meters.set(generationId, { userId, inputUsd, outputRate: rates.output, chars: 0 });
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
    const user = this.account(this.db, m.userId);
    return user !== undefined && user.cap !== null && user.spent + this.liveUsd(m.userId) >= user.cap;
  }

  release(_userId: string, generationId: string): void {
    this.meters.delete(generationId);
  }

  settle(userId: string, generationId: string, costUsd: number): void {
    this.release(userId, generationId);
    this.db.transaction((tx) => this.spend(tx, userId, costUsd));
  }

  /** Every settled cost lands here, in the caller's transaction: the user's spend and, for a guest, its budgets. */
  spend(tx: SpendDb, userId: string, costUsd: number): void {
    if (costUsd <= 0) return;
    tx.update(users)
      .set({ costSpentUsd: sql`${users.costSpentUsd} + ${costUsd}` })
      .where(eq(users.id, userId))
      .run();
    if (!this.guests) return;
    const user = this.account(tx, userId);
    if (user) this.guests.budgets.debit(tx, this.budgetKeys(user), costUsd);
  }

  /** For admission only: message_start replaces it with the billed count. UTF-8 bytes, not characters, so dense scripts and emoji are not under-counted. */
  static estimateInputTokens(bytes: number): number {
    return Math.ceil(bytes / CHARS_PER_TOKEN) + 100;
  }

  static outputRate(model: string): number {
    return ratesFor(model).output;
  }
}
