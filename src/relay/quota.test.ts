import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@db/client";
import { spendBuckets, users } from "@db/schema";
import { ALL_GUESTS, Budgets } from "./budgets";
import { BudgetExceededError, PromptTooLongError, QuotaExceededError, QuotaManager } from "./quota";
import { createTestDb, seedUser } from "./test-utils";

let db: Db;
let quota: QuotaManager;
const cap = (usd: number | null, spent = 0) => db.update(users).set({ costCapUsd: usd, costSpentUsd: spent }).where(eq(users.id, "u1")).run();

describe("QuotaManager (metered, cut off at the cap)", () => {
  beforeEach(() => {
    db = createTestDb();
    seedUser(db, "u1");
    quota = new QuotaManager(db);
  });

  it("admits a reply whose input fits, at the rate its prompt is priced at, and refuses one that does not", () => {
    // Haiku: $0.10 / M input below 100k tokens, so 10k tokens cost $0.001.
    cap(0.0015);
    quota.admit("u1", "g1", "claude-haiku-5-5", 10_000);
    expect(() => quota.admit("u1", "g2", "claude-haiku-5-5", 10_000)).toThrow(QuotaExceededError);
  });

  it("meters streamed text across the user's live replies and reports the cap once they reach it", () => {
    // Haiku output: $0.50 / M; 2.5 characters a token, so 250k characters are $0.05.
    cap(0.1);
    quota.admit("u1", "g1", "claude-haiku-5-5", 0);
    quota.admit("u1", "g2", "claude-haiku-5-5", 0);
    expect(quota.meter("g1", 250_000)).toBe(false);
    expect(quota.meter("g2", 249_000)).toBe(false);
    expect(quota.meter("g2", 1_000)).toBe(true);
    // A released reply no longer counts.
    quota.release("u1", "g2");
    expect(quota.meter("g1", 0)).toBe(false);
  });

  it("swaps the input estimate for message_start's billed prompt, cache writes and the long-context tier included", () => {
    cap(0.1);
    quota.admit("u1", "g1", "claude-haiku-5-5", 0);
    // 80k uncached and 40k written to the cache: over 100k, so $0.50 and $0.625 / M, and output at $2.50 / M.
    quota.started("g1", "claude-haiku-5-5", { inputTokens: 80_000, cacheReadTokens: 0, cacheWriteTokens: 40_000 });
    expect(quota.meter("g1", 0)).toBe(false);
    // $0.04 + $0.025 in, so $0.035 of output (14k tokens, 35k characters) reaches the cap.
    expect(quota.meter("g1", 34_900)).toBe(false);
    expect(quota.meter("g1", 200)).toBe(true);
  });

  it("does not meter a user without a cap", () => {
    cap(null);
    quota.admit("u1", "g1", "claude-opus-5-5", 1_000_000);
    expect(quota.meter("g1", 10_000_000)).toBe(false);
  });
});

describe("QuotaManager: guests", () => {
  let budgets: Budgets;
  const buckets = () => Object.fromEntries(db.select().from(spendBuckets).all().map((b) => [b.key, b.levelUsd]));

  beforeEach(() => {
    db = createTestDb();
    seedUser(db, "g1", { role: "guest", costCapUsd: 0.1, budgetKeys: ["ip:203.0.113.7"] });
    seedUser(db, "u1");
    budgets = new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => 0);
    quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets });
  });

  it("refuses a guest's oversized prompt first, then a reply over its cap, then one its spent budgets cannot take", () => {
    budgets.debit(db, ["ip:203.0.113.7"], 1.25);
    db.update(users).set({ costSpentUsd: 0.1 }).where(eq(users.id, "g1")).run();
    expect(() => quota.admit("g1", "a", "claude-haiku-5-5", 60_001)).toThrow(PromptTooLongError);
    expect(() => quota.admit("g1", "b", "claude-haiku-5-5", 60_000)).toThrow(QuotaExceededError);
    db.update(users).set({ costSpentUsd: 0 }).where(eq(users.id, "g1")).run();
    let refusal: unknown;
    try {
      quota.admit("g1", "c", "claude-haiku-5-5", 60_000);
    } catch (err) {
      refusal = err;
    }
    // $0.25 over a $1-a-day budget: a quarter of a day.
    expect(refusal).toBeInstanceOf(BudgetExceededError);
    expect(refusal).toMatchObject({ retryAfterMs: 6 * 3_600_000 });
    // None of it applies to an invited user.
    expect(() => quota.admit("u1", "d", "claude-haiku-5-5", 90_000)).not.toThrow();
  });

  it("charges a guest's spend to its address and to every guest's budget, and only to the user's spend otherwise", () => {
    db.transaction((tx) => quota.spend(tx, "g1", 0.03));
    quota.settle("u1", "x", 0.5);
    expect(buckets()).toEqual({ "ip:203.0.113.7": 0.03, [ALL_GUESTS]: 0.03 });
    expect(db.select({ id: users.id, spent: users.costSpentUsd }).from(users).all()).toEqual(
      expect.arrayContaining([{ id: "g1", spent: 0.03 }, { id: "u1", spent: 0.5 }]),
    );
  });

  it("charges a guest with no recorded address to every guest's budget", () => {
    db.update(users).set({ budgetKeys: null }).where(eq(users.id, "g1")).run();
    quota.settle("g1", "x", 0.02);
    expect(buckets()).toEqual({ [ALL_GUESTS]: 0.02 });
  });
});
