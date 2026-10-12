import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@db/client";
import { spendBuckets } from "@db/schema";
import { ALL_GUESTS, Budgets } from "./budgets";
import { createTestDb } from "./test-utils";

const HOUR = 3_600_000;
let db: Db;
let clock: number;
let budgets: Budgets;

beforeEach(() => {
  db = createTestDb();
  clock = Date.UTC(2026, 9, 12);
  budgets = new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => clock);
});

describe("Budgets", () => {
  it("lets a day's budget go at once, then waits for what went over to drain", () => {
    expect(budgets.check(["ip:10.0.0.1"])).toBeNull();
    budgets.debit(db, ["ip:10.0.0.1"], 1);
    expect(budgets.check(["ip:10.0.0.1"])).toBeNull();
    budgets.debit(db, ["ip:10.0.0.1"], 0.25);
    // $0.25 over a $1-a-day budget drains in a quarter of a day.
    expect(budgets.check(["ip:10.0.0.1"])).toBe(6 * HOUR);
    clock += 6 * HOUR;
    expect(budgets.check(["ip:10.0.0.1"])).toBeNull();
    expect(budgets.check(["ip:10.0.0.2"])).toBeNull();
  });

  it("drains continuously and never below empty", () => {
    budgets.debit(db, ["ip:10.0.0.1"], 1.5);
    clock += 6 * HOUR;
    budgets.debit(db, ["ip:10.0.0.1"], 0.5);
    // 1.5 - 0.25 + 0.5 is $0.75 over.
    expect(budgets.check(["ip:10.0.0.1"])).toBe(18 * HOUR);
    clock += 30 * 24 * HOUR;
    budgets.debit(db, ["ip:10.0.0.1"], 1);
    expect(db.select().from(spendBuckets).get()?.levelUsd).toBe(1);
    expect(budgets.check(["ip:10.0.0.1"])).toBeNull();
  });

  it("drains each kind of key at its own rate and answers with the longest wait", () => {
    const keys = ["ip:2001:db8:1:2::/64", "ip48:2001:db8:1::/48", ALL_GUESTS];
    budgets.debit(db, keys, 4);
    // Over by $3 at $1 a day, $1 at $3 a day, and not at all at $10.
    expect(budgets.check(keys)).toBe(72 * HOUR);
    expect(budgets.check(keys.slice(1))).toBeCloseTo(8 * HOUR, -1);
    expect(budgets.check([ALL_GUESTS])).toBeNull();
    expect(budgets.check([])).toBeNull();
  });

  it("debits inside the caller's transaction, so a rollback takes it back", () => {
    expect(() =>
      db.transaction((tx) => {
        budgets.debit(tx, [ALL_GUESTS], 20);
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(budgets.check([ALL_GUESTS])).toBeNull();
  });
});
