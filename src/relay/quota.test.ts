import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import { QuotaExceededError, QuotaManager } from "./quota";
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
