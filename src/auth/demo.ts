import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@db/client";

export const DEMO_TTL_MS = 24 * 60 * 60 * 1000;

/** ADR-0004: demo users live 24 h; cascades remove their sessions, chats, messages and usage. */
export function purgeExpiredDemoUsers(now: Date = new Date()): number {
  const db = getDb();
  const cutoff = new Date(now.getTime() - DEMO_TTL_MS);
  const result = db
    .delete(schema.users)
    .where(and(eq(schema.users.role, "demo"), lt(schema.users.createdAt, cutoff)))
    .run();
  return result.changes;
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startDemoPurgeTimer(intervalMs = 60 * 60 * 1000): void {
  if (timer) return;
  const run = () => {
    try {
      const n = purgeExpiredDemoUsers();
      if (n > 0) console.log(`[demo] purged ${n} expired demo user(s)`);
    } catch (err) {
      console.error("[demo] purge failed", err);
    }
  };
  run();
  timer = setInterval(run, intervalMs);
  timer.unref();
}

export function stopDemoPurgeTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
