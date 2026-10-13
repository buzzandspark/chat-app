import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";
import { modelDisplayName } from "@shared/models";

const { usageEvents, users } = schema;

/** Haiku's side calls for Explore options; every other usage row is a chat reply (`message`, `fallback_message`). */
const EXPLORE_ITERATIONS = ["options", "options_rewrite"];

export interface UsageTotals {
  costUsd: number;
  /** Uncached input plus cache reads and writes. */
  inputTokens: number;
  outputTokens: number;
}

interface UsagePeriod {
  chats: UsageTotals;
  explore: UsageTotals;
}

/** One model's spend (for chats, a fallback's serving model counts as its own). */
export interface ModelUsage {
  model: string;
  label: string;
  today: UsageTotals;
  all: UsageTotals;
}

export interface UsageSummary {
  today: UsagePeriod;
  all: UsagePeriod;
  /** The chats total broken down by model, most spent first. */
  chatModels: ModelUsage[];
  /** The Explore total broken down by model, the same way. */
  exploreModels: ModelUsage[];
  /** The cap's own counter, which is what the cap is enforced against. */
  spentUsd: number;
  capUsd: number | null;
}

export interface UserSettings {
  exploreOptions: boolean;
}

const zero = (): UsageTotals => ({ costUsd: 0, inputTokens: 0, outputTokens: 0 });

/** The first instant of `now`'s day, in UTC. */
export function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The user's spend split between chat replies (by model) and Explore, today (UTC) and all time. */
export function usageSummary(userId: string, now: Date, db: Db = getDb()): UsageSummary {
  const explore = sql<number>`${inArray(usageEvents.iterationType, EXPLORE_ITERATIONS)}`;
  const recent = sql<number>`${usageEvents.createdAt} >= ${dayStart(now).getTime()}`;
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
  const summary: UsageSummary = { today: { chats: zero(), explore: zero() }, all: { chats: zero(), explore: zero() }, chatModels: [], exploreModels: [], spentUsd: 0, capUsd: null };
  const byModel = { chats: new Map<string, ModelUsage>(), explore: new Map<string, ModelUsage>() };
  const add = (into: UsageTotals, row: UsageTotals) => {
    into.costUsd += row.costUsd;
    into.inputTokens += row.inputTokens;
    into.outputTokens += row.outputTokens;
  };
  for (const row of rows) {
    const kind = row.explore ? "explore" : "chats";
    add(summary.all[kind], row);
    if (row.recent) add(summary.today[kind], row);
    let entry = byModel[kind].get(row.model);
    if (!entry) {
      entry = { model: row.model, label: modelDisplayName(row.model).replace(/^Claude /, ""), today: zero(), all: zero() };
      byModel[kind].set(row.model, entry);
    }
    add(entry.all, row);
    if (row.recent) add(entry.today, row);
  }
  const ranked = (models: Map<string, ModelUsage>) => [...models.values()].sort((a, b) => b.all.costUsd - a.all.costUsd || a.label.localeCompare(b.label));
  summary.chatModels = ranked(byModel.chats);
  summary.exploreModels = ranked(byModel.explore);
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

/** The cap's own counter and the cap (null: no cap), for the header's usage bar. */
export function capUsage(userId: string, db: Db = getDb()): { spentUsd: number; capUsd: number | null } {
  const row = db.select({ cap: schema.users.costCapUsd, spent: schema.users.costSpentUsd }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return { spentUsd: row?.spent ?? 0, capUsd: row?.cap ?? null };
}
