import { eq, sql } from "drizzle-orm";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import type { UserRole } from "@shared/types";
import { costOf, ratesFor, type TokenCounts } from "./anthropic/pricing";
import { GUEST_MAX_TOKENS, MAX_TOKENS } from "./anthropic/thinking-config";
import { ALL_GUESTS, SHARED_ADDRESS_KEYS, type Budgets } from "./budgets";

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
  /** Prompt tokens a guest may send, counted exactly; kept below the long-context price tier. */
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
  /** A guest call's worst-case cost, held until it settles; guests are not metered. Null for an invited user's metered reply. */
  reservedUsd: number | null;
  keys: string[];
  model: string;
  promptBytes: number;
}

/** A token never covers less than one byte, so bytes plus the system prompts and framing bound a prompt from above. */
const PROMPT_OVERHEAD_TOKENS = 4096;
/** Natural text in every script measured runs above 1.25 UTF-8 bytes a token; denser prompts are machine payloads such as base64. */
const PAYLOAD_BYTES_PER_TOKEN = 1.2;
/** An address that sends an over-long payload is refused for this many days of its budget. */
const PAYLOAD_PENALTY_DAYS = 2;

/** The most a guest call can cost: every prompt token written to the cache, every output token used. */
function worstCaseUsd(model: string, promptTokens: number): number {
  const rates = ratesFor(model, promptTokens);
  return (promptTokens * Math.max(rates.input, rates.cacheWrite) + GUEST_MAX_TOKENS * rates.output) / 1_000_000;
}

function metered(m: Meter): number {
  return m.inputUsd + (Math.ceil(m.chars / CHARS_PER_TOKEN) * m.outputRate) / 1_000_000;
}

// A user's reply is admitted only while its estimated input plus max_tokens of output fits under the cap beside their running
// replies' worst cases; it is then metered as it streams and all their replies stop once the meters reach the cap.
// A guest call instead holds its worst-case cost from the start, so neither its cap nor its budgets overshoot.
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

  /** What the user's running calls have used so far, as metered; a guest call counts its hold. */
  private liveUsd(userId: string): number {
    let usd = 0;
    for (const m of this.meters.values()) if (m.userId === userId) usd += m.reservedUsd ?? metered(m);
    return usd;
  }

  /** The most the user's running calls can still cost: a metered reply counts max_tokens of output. */
  private heldUsd(userId: string, except?: string): number {
    let usd = 0;
    for (const [id, m] of this.meters) {
      if (m.userId !== userId || id === except) continue;
      usd += m.reservedUsd ?? Math.max(metered(m), m.inputUsd + (MAX_TOKENS * m.outputRate) / 1_000_000);
    }
    return usd;
  }

  private heldOn(key: string, except?: string): number {
    let usd = 0;
    for (const [id, m] of this.meters) if (id !== except && m.keys.includes(key)) usd += m.reservedUsd ?? 0;
    return usd;
  }

  /** Throws unless `usd` more fits under the user's cap and, for a guest, under every budget it is charged to. */
  private hold(user: { cap: number | null; spent: number }, userId: string, id: string, usd: number, keys: string[]): void {
    if (user.cap !== null && user.spent + this.heldUsd(userId, id) + usd > user.cap) throw new QuotaExceededError(user.spent, user.cap);
    const waitMs = this.guests?.budgets.check(keys, (key) => this.heldOn(key, id) + usd) ?? null;
    if (waitMs !== null) throw new BudgetExceededError(waitMs);
  }

  /** Refuses a call over the user's cap and, for a guest, one its budgets cannot take. `promptBytes` is the UTF-8 size of the prompt's text. */
  admit(userId: string, id: string, model: string, promptBytes: number): void {
    const user = this.account(this.db, userId);
    if (!user) return;
    if (this.guests && user.role === "guest") {
      const keys = this.budgetKeys(user);
      // A prompt over the limit is refused once counted, before it is sent, so the hold never needs more than the limit.
      const reservedUsd = worstCaseUsd(model, Math.min(promptBytes + PROMPT_OVERHEAD_TOKENS, this.guests.maxPromptTokens));
      this.hold(user, userId, id, reservedUsd, keys);
      this.meters.set(id, { userId, inputUsd: 0, outputRate: 0, chars: 0, reservedUsd, keys, model, promptBytes });
      return;
    }
    const estimatedInputTokens = Math.ceil(promptBytes / CHARS_PER_TOKEN) + 100;
    const rates = ratesFor(model, estimatedInputTokens);
    const inputUsd = (estimatedInputTokens * rates.input) / 1_000_000;
    // Atomic in a single-threaded process: the sum and the insert happen in one tick. Every reply is metered, so a cap set mid-reply stops it.
    this.hold(user, userId, id, inputUsd + (MAX_TOKENS * rates.output) / 1_000_000, []);
    this.meters.set(id, { userId, inputUsd, outputRate: rates.output, chars: 0, reservedUsd: null, keys: [], model, promptBytes });
  }

  /** True when a guest call's byte bound is within the guest limit: its hold already covers the prompt, so it needs no count. */
  boundFits(id: string): boolean {
    const m = this.meters.get(id);
    return !m || m.reservedUsd === null || !this.guests || m.promptBytes + PROMPT_OVERHEAD_TOKENS <= this.guests.maxPromptTokens;
  }

  /**
   * A guest call's exact prompt, from the token-counting endpoint (null when the provider cannot count, which falls back to the byte bound).
   * Throws PromptTooLongError over the guest limit, after filling the address's budget when the prompt is a dense payload.
   */
  fit(id: string, promptTokens: number | null): void {
    const m = this.meters.get(id);
    if (!m || m.reservedUsd === null || !this.guests) return;
    const tokens = promptTokens ?? m.promptBytes + PROMPT_OVERHEAD_TOKENS;
    if (tokens > this.guests.maxPromptTokens) {
      if (promptTokens !== null && m.promptBytes / promptTokens < PAYLOAD_BYTES_PER_TOKEN) {
        const guests = this.guests;
        const own = m.keys.filter((k) => k.startsWith("ip:") && !SHARED_ADDRESS_KEYS.has(k));
        this.db.transaction((tx) => guests.budgets.fill(tx, own, PAYLOAD_PENALTY_DAYS));
      }
      throw new PromptTooLongError(tokens, this.guests.maxPromptTokens);
    }
    const reservedUsd = worstCaseUsd(m.model, tokens);
    if (reservedUsd > m.reservedUsd) {
      const user = this.account(this.db, m.userId);
      if (user) this.hold(user, m.userId, id, reservedUsd, m.keys);
    }
    m.reservedUsd = reservedUsd;
  }

  /** Why the user may not spend now: its cap is reached or, for a guest, a budget is spent. Null when it may. */
  spendBlock(userId: string): QuotaExceededError | BudgetExceededError | null {
    const user = this.account(this.db, userId);
    if (!user) return null;
    if (user.cap !== null && user.spent + this.heldUsd(userId) >= user.cap) return new QuotaExceededError(user.spent, user.cap);
    const waitMs = this.guests?.budgets.check(this.budgetKeys(user), (key) => this.heldOn(key)) ?? null;
    return waitMs === null ? null : new BudgetExceededError(waitMs);
  }

  /** The prompt as message_start billed it, cache writes and the long-context tier included. False when a guest's prompt is over its limit after all. */
  started(id: string, model: string, usage: Omit<TokenCounts, "outputTokens">): boolean {
    const m = this.meters.get(id);
    if (!m) return true;
    const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    if (m.reservedUsd !== null) return promptTokens <= (this.guests?.maxPromptTokens ?? Infinity);
    m.inputUsd = costOf(model, { ...usage, outputTokens: 0 });
    m.outputRate = ratesFor(model, promptTokens).output;
    return true;
  }

  /** Counts streamed text (reply or thinking); true once the user's spend and live replies reach the cap. A guest's hold already covers it. */
  meter(id: string, chars: number): boolean {
    const m = this.meters.get(id);
    if (!m || m.reservedUsd !== null) return false;
    m.chars += chars;
    const user = this.account(this.db, m.userId);
    return user !== undefined && user.cap !== null && user.spent + this.liveUsd(m.userId) >= user.cap;
  }

  /** An estimate clamped to what one call can bill: max_tokens of output and, for a guest, the prompt limit. */
  bounded(db: Pick<Db, "select">, userId: string, tokens: TokenCounts): TokenCounts {
    const guest = this.account(db, userId)?.role === "guest";
    return {
      ...tokens,
      inputTokens: guest && this.guests ? Math.min(tokens.inputTokens, this.guests.maxPromptTokens) : tokens.inputTokens,
      outputTokens: Math.min(tokens.outputTokens, guest ? GUEST_MAX_TOKENS : MAX_TOKENS),
    };
  }

  release(_userId: string, id: string): void {
    this.meters.delete(id);
  }

  settle(userId: string, id: string, costUsd: number): void {
    this.release(userId, id);
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

  static outputRate(model: string): number {
    return ratesFor(model).output;
  }
}
