import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";

const { usageEvents, users } = schema;

/** Haiku's side calls for Explore options; every other usage row is a chat reply (`message`, `fallback_message`). */
export const EXPLORE_ITERATIONS = ["options", "options_rewrite"];

export interface UsageTotals {
  costUsd: number;
  /** Uncached input plus cache reads and writes. */
  inputTokens: number;
  outputTokens: number;
}

export interface UsagePeriod {
  chats: UsageTotals;
  explore: UsageTotals;
}

export interface UsageSummary {
  month: UsagePeriod;
  all: UsagePeriod;
  /** The cap's own counter, which is what the cap is enforced against. */
  spentUsd: number;
  capUsd: number | null;
}

export interface UserSettings {
  exploreOptions: boolean;
}

const zero = (): UsageTotals => ({ costUsd: 0, inputTokens: 0, outputTokens: 0 });

/** The first instant of `now`'s calendar month, in UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The user's spend split between chat replies and Explore, this month (UTC) and all time. */
export function usageSummary(userId: string, now: Date, db: Db = getDb()): UsageSummary {
  const explore = sql<number>`${inArray(usageEvents.iterationType, EXPLORE_ITERATIONS)}`;
  const recent = sql<number>`${usageEvents.createdAt} >= ${monthStart(now).getTime()}`;
  const rows = db
    .select({
      explore,
      recent,
      costUsd: sql<number>`sum(${usageEvents.costUsd})`,
      inputTokens: sql<number>`sum(${usageEvents.inputTokens} + ${usageEvents.cacheReadTokens} + ${usageEvents.cacheWriteTokens})`,
      outputTokens: sql<number>`sum(${usageEvents.outputTokens})`,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .groupBy(explore, recent)
    .all();
  const summary: UsageSummary = { month: { chats: zero(), explore: zero() }, all: { chats: zero(), explore: zero() }, spentUsd: 0, capUsd: null };
  for (const row of rows) {
    const kind = row.explore ? "explore" : "chats";
    for (const period of row.recent ? [summary.month, summary.all] : [summary.all]) {
      period[kind].costUsd += row.costUsd;
      period[kind].inputTokens += row.inputTokens;
      period[kind].outputTokens += row.outputTokens;
    }
  }
  const cap = db.select({ cap: users.costCapUsd, spent: users.costSpentUsd }).from(users).where(eq(users.id, userId)).get();
  summary.spentUsd = cap?.spent ?? 0;
  summary.capUsd = cap?.cap ?? null;
  return summary;
}

export function getUserSettings(userId: string, db: Db = getDb()): UserSettings {
  const row = db.select({ exploreOptions: users.exploreOptions }).from(users).where(eq(users.id, userId)).get();
  return { exploreOptions: row?.exploreOptions ?? true };
}

/** False when there is no such user. */
export function updateUserSettings(userId: string, settings: UserSettings, db: Db = getDb()): boolean {
  return db.update(users).set(settings).where(eq(users.id, userId)).run().changes > 0;
}
