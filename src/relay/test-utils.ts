import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@db/schema";
import type { Db } from "@db/client";
import { applyMigrations } from "@db/migrator";
import { isTerminal, type RelayEvent } from "./events";
import type { EventStore } from "./store";

export function createTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  applyMigrations(sqlite);
  return drizzle(sqlite, { schema });
}

export function seedUser(db: Db, id: string, extra: Partial<typeof schema.users.$inferInsert> = {}): void {
  db.insert(schema.users)
    .values({ id, name: id, email: `${id}@example.com`, emailVerified: true, role: "user", ...extra })
    .run();
}

export function collectUntilTerminal(store: EventStore, generationId: string, timeoutMs = 10_000): Promise<RelayEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RelayEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${generationId}; got ${events.map((e) => e.type).join(",")}`)), timeoutMs);
    // A finished generation replays inside subscribe(), before `unsubscribe` is assigned.
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      clearTimeout(timer);
      unsubscribe?.();
      resolve(events);
    };
    unsubscribe = store.subscribe(generationId, -1, (e) => {
      events.push(e);
      if (isTerminal(e)) finish();
    });
    if (store.get(generationId)?.terminal) finish();
  });
}

export function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}
