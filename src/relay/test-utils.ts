import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@db/schema";
import type { Db } from "@db/client";
import type { RelayEvent } from "./events";
import type { EventStore } from "./store";

/** A fresh in-memory database with migrations applied, for engine tests. */
export function createTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });
  return db;
}

export function seedUser(db: Db, id: string, extra: Partial<typeof schema.users.$inferInsert> = {}): void {
  db.insert(schema.users)
    .values({ id, name: id, email: `${id}@example.com`, emailVerified: true, role: "user", ...extra })
    .run();
}

/** Collects every event for a generation until its terminal event. */
export function collectUntilTerminal(store: EventStore, generationId: string, timeoutMs = 10_000): Promise<RelayEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RelayEvent[] = [];
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${generationId}; got ${events.map((e) => e.type).join(",")}`)), timeoutMs);
    const unsubscribe = store.subscribe(generationId, -1, (e) => {
      events.push(e);
      if (store.get(generationId)?.terminal) {
        clearTimeout(timer);
        unsubscribe();
        resolve(events);
      }
    });
    if (store.get(generationId)?.terminal) {
      clearTimeout(timer);
      resolve(events);
    }
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
