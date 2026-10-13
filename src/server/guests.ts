import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";

export const GUEST_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

/** Guests idle for 30 days are deleted; their sessions, chats, replies and usage cascade. */
export function purgeIdleGuests(now: Date = new Date(), db: Db = getDb()): number {
  // Stored as epoch milliseconds; a raw expression compares against a number, not a Date.
  const cutoff = now.getTime() - GUEST_IDLE_MS;
  const lastSeen = sql`coalesce(${schema.users.lastActiveAt}, ${schema.users.createdAt})`;
  return db
    .delete(schema.users)
    .where(and(eq(schema.users.role, "guest"), lt(lastSeen, cutoff)))
    .run().changes;
}

/** A new guest's first activity, and the address keys its spend is charged to. */
export function recordGuestStart(userId: string, budgetKeys: string[], db: Db = getDb()): void {
  db.update(schema.users).set({ lastActiveAt: new Date(), budgetKeys }).where(eq(schema.users.id, userId)).run();
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startGuestPurge(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  const run = () => {
    try {
      const n = purgeIdleGuests();
      if (n > 0) console.log(`[guests] purged ${n} idle guest(s)`);
    } catch (err) {
      console.error("[guests] purge failed", err);
    }
  };
  run();
  timer = setInterval(run, intervalMs);
  timer.unref();
}
