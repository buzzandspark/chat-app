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
    // Haiku output: $0.50 / M; 4 characters a token, so 400k characters are $0.05.
    cap(0.1);
    quota.admit("u1", "g1", "claude-haiku-5-5", 0);
    quota.admit("u1", "g2", "claude-haiku-5-5", 0);
    expect(quota.meter("g1", 400_000)).toBe(false);
    expect(quota.meter("g2", 399_000)).toBe(false);
    expect(quota.meter("g2", 1_000)).toBe(true);
    // A released reply no longer counts.
    quota.release("u1", "g2");
    expect(quota.meter("g1", 0)).toBe(false);
  });

  it("does not meter a user without a cap", () => {
    cap(null);
    quota.admit("u1", "g1", "claude-opus-5-5", 1_000_000);
    expect(quota.meter("g1", 10_000_000)).toBe(false);
  });
});
