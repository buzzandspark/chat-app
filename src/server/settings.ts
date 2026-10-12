import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";
import { modelDisplayName } from "@shared/models";

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

/** One model's chat replies (a fallback's serving model counts as its own). */
export interface ModelUsage {
  model: string;
  label: string;
  month: UsageTotals;
  all: UsageTotals;
}

export interface UsageSummary {
  month: UsagePeriod;
  all: UsagePeriod;
  /** The chats total broken down by model, most spent first. */
  chatModels: ModelUsage[];
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

/** The user's spend split between chat replies (by model) and Explore, this month (UTC) and all time. */
export function usageSummary(userId: string, now: Date, db: Db = getDb()): UsageSummary {
  const explore = sql<number>`${inArray(usageEvents.iterationType, EXPLORE_ITERATIONS)}`;
  const recent = sql<number>`${usageEvents.createdAt} >= ${monthStart(now).getTime()}`;
  const rows = db
    .select({
      explore,
      recent,
      model: usageEvents.model,
      costUsd: sql<number>`sum(${usageEvents.costUsd})`,
      inputTokens: sql<number>`sum(${usageEvents.inputTokens} + ${usageEvents.cacheReadTokens} + ${usageEvents.cacheWriteTokens})`,
      outputTokens: sql<number>`sum(${usageEvents.outputTokens})`,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .groupBy(explore, recent, usageEvents.model)
    .all();
  const summary: UsageSummary = { month: { chats: zero(), explore: zero() }, all: { chats: zero(), explore: zero() }, chatModels: [], spentUsd: 0, capUsd: null };
  const byModel = new Map<string, ModelUsage>();
  const add = (into: UsageTotals, row: UsageTotals) => {
    into.costUsd += row.costUsd;
    into.inputTokens += row.inputTokens;
    into.outputTokens += row.outputTokens;
  };
  for (const row of rows) {
    const kind = row.explore ? "explore" : "chats";
    add(summary.all[kind], row);
    if (row.recent) add(summary.month[kind], row);
    if (kind === "explore") continue;
    let entry = byModel.get(row.model);
    if (!entry) {
      entry = { model: row.model, label: modelDisplayName(row.model).replace(/^Claude /, ""), month: zero(), all: zero() };
      byModel.set(row.model, entry);
    }
    add(entry.all, row);
    if (row.recent) add(entry.month, row);
  }
  summary.chatModels = [...byModel.values()].sort((a, b) => b.all.costUsd - a.all.costUsd || a.label.localeCompare(b.label));
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
