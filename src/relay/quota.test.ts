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
    // 24,750 bytes at 2.5 a token, plus 100, is 10k tokens; Haiku's $0.10 / M below 100k tokens makes that $0.001.
    cap(0.0015);
    quota.admit("u1", "g1", "claude-haiku-5-5", 24_750);
    expect(() => quota.admit("u1", "g2", "claude-haiku-5-5", 24_750)).toThrow(QuotaExceededError);
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

  // Haiku's worst case for a prompt of n tokens: n at the $0.125 / M cache-write rate plus 8192 output tokens at $0.50 / M.
  const worst = (tokens: number) => (tokens * 0.125 + 8192 * 0.5) / 1_000_000;

  it("holds each running call's worst case against the guest's cap, sized by its bytes until the exact count arrives", () => {
    db.update(users).set({ costCapUsd: 0.016 }).where(eq(users.id, "g1")).run();
    // 200 kB is bounded by the 60k limit; an empty prompt by the 4096 tokens of system prompts and framing.
    quota.admit("g1", "a", "claude-haiku-5-5", 200_000);
    expect(worst(60_000) + worst(4096)).toBeGreaterThan(0.016);
    expect(() => quota.admit("g1", "b", "claude-haiku-5-5", 0)).toThrow(QuotaExceededError);
    quota.fit("a", 10_000);
    quota.admit("g1", "b", "claude-haiku-5-5", 0);
    // The holds cover every token a guest call can produce, so nothing is metered.
    expect(quota.meter("a", 10_000_000)).toBe(false);
    quota.release("g1", "a");
    quota.release("g1", "b");
    // None of it applies to an invited user.
    expect(() => quota.admit("u1", "c", "claude-haiku-5-5", 300_000)).not.toThrow();
  });

  it("refuses a prompt over the limit once counted, and cuts off the address of a dense payload", () => {
    quota.admit("g1", "a", "claude-haiku-5-5", 200_000);
    expect(() => quota.fit("a", 60_001)).toThrow(PromptTooLongError);
    // Without a count the byte bound decides.
    quota.admit("g1", "b", "claude-haiku-5-5", 60_000);
    expect(() => quota.fit("b", null)).toThrow(PromptTooLongError);
    expect(buckets()).toEqual({});
    // Base64 runs about 1.05 bytes a token: two days of the address's budget, none of every guest's.
    quota.admit("g1", "c", "claude-haiku-5-5", 70_000);
    expect(() => quota.fit("c", 66_000)).toThrow(PromptTooLongError);
    expect(buckets()).toEqual({ "ip:203.0.113.7": 2 });
    expect(() => quota.admit("g1", "d", "claude-haiku-5-5", 0)).toThrow(BudgetExceededError);
  });

  it("never cuts off an address key many guests share for one guest's payload", () => {
    db.update(users).set({ budgetKeys: ["ip:unknown"] }).where(eq(users.id, "g1")).run();
    quota.admit("g1", "a", "claude-haiku-5-5", 70_000);
    expect(() => quota.fit("a", 66_000)).toThrow(PromptTooLongError);
    expect(buckets()).toEqual({});
  });

  it("reports a guest prompt that message_start bills over the limit", () => {
    quota.admit("g1", "a", "claude-haiku-5-5", 0);
    expect(quota.started("a", "claude-haiku-5-5", { inputTokens: 50_000, cacheReadTokens: 10_000, cacheWriteTokens: 0 })).toBe(true);
    expect(quota.started("a", "claude-haiku-5-5", { inputTokens: 50_000, cacheReadTokens: 10_000, cacheWriteTokens: 1 })).toBe(false);
  });

  it("counts held calls against the guest's budgets, so they never fill past a day", () => {
    budgets.debit(db, ["ip:203.0.113.7"], 0.99);
    quota.admit("g1", "a", "claude-haiku-5-5", 0);
    quota.admit("g1", "b", "claude-haiku-5-5", 0);
    expect(0.99 + 3 * worst(4096)).toBeGreaterThan(1);
    expect(() => quota.admit("g1", "c", "claude-haiku-5-5", 0)).toThrow(BudgetExceededError);
    expect(quota.spendBlock("g1")).toBeNull();
    quota.release("g1", "a");
    quota.admit("g1", "c", "claude-haiku-5-5", 0);
  });

  it("clamps an estimate to what one call can bill: max_tokens of output and, for a guest, the prompt limit", () => {
    const estimate = { inputTokens: 100_000, outputTokens: 50_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(quota.bounded(db, "g1", estimate)).toEqual({ ...estimate, inputTokens: 60_000, outputTokens: 8192 });
    expect(quota.bounded(db, "u1", estimate)).toEqual({ ...estimate, outputTokens: 16_000 });
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
