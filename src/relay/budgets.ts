import { inArray } from "drizzle-orm";
import type { Db } from "@db/client";
import { spendBuckets } from "@db/schema";

const DAY_MS = 86_400_000;

/** The budget every guest shares; a guest's own keys are on its user row. */
export const ALL_GUESTS = "guests";

/** USD a day for each kind of key: `ip:`, `ip48:` and ALL_GUESTS. */
export interface BudgetRates {
  ip: number;
  ip48: number;
  all: number;
}

export type BudgetDb = Pick<Db, "select" | "insert">;

/**
 * One leaky bucket per key: spend fills it and it drains continuously at the key's rate, so a day's budget can go at once
 * and then a day's worth a day. Spend already running when a bucket fills still lands in it: the caps are soft.
 */
export class Budgets {
  constructor(
    private db: Db,
    private rates: BudgetRates,
    private now: () => number = Date.now,
  ) {}

  /** Null while every bucket is within a day's budget, else the wait until the fullest drains back to it. */
  check(keys: readonly string[]): number | null {
    let waitMs = 0;
    for (const [key, level] of this.levels(this.db, keys, this.now())) {
      const rate = this.rate(key);
      if (level > rate) waitMs = Math.max(waitMs, Math.ceil(((level - rate) / rate) * DAY_MS));
    }
    return waitMs > 0 ? waitMs : null;
  }

  debit(tx: BudgetDb, keys: readonly string[], usd: number): void {
    if (usd <= 0 || keys.length === 0) return;
    const now = this.now();
    const levels = this.levels(tx, keys, now);
    const updatedAt = new Date(now);
    for (const key of keys) {
      const levelUsd = (levels.get(key) ?? 0) + usd;
      tx.insert(spendBuckets)
        .values({ key, levelUsd, updatedAt })
        .onConflictDoUpdate({ target: spendBuckets.key, set: { levelUsd, updatedAt } })
        .run();
    }
  }

  private levels(db: BudgetDb, keys: readonly string[], now: number): Map<string, number> {
    if (keys.length === 0) return new Map();
    const rows = db.select().from(spendBuckets).where(inArray(spendBuckets.key, [...keys])).all();
    return new Map(rows.map((r) => [r.key, Math.max(0, r.levelUsd - (this.rate(r.key) * Math.max(0, now - r.updatedAt.getTime())) / DAY_MS)]));
  }

  private rate(key: string): number {
    if (key === ALL_GUESTS) return this.rates.all;
    return key.startsWith("ip48:") ? this.rates.ip48 : this.rates.ip;
  }
}
