import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

interface DbHandle {
  db: Db;
  sqlite: Database.Database;
  path: string;
}

// One connection per process (D1). Cached on globalThis so dev HMR does not
// open a new handle on every reload.
const g = globalThis as unknown as { __cadenceDb?: DbHandle };

export function openDatabase(filePath: string = process.env.DATABASE_PATH ?? "data/app.db"): DbHandle {
  if (g.__cadenceDb && g.__cadenceDb.path === filePath) return g.__cadenceDb;
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // SQLite's lower() folds ASCII only; search needs the same folding as the query (JavaScript's).
  sqlite.function("unicode_lower", { deterministic: true }, (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value));
  const db = drizzle(sqlite, { schema });
  g.__cadenceDb = { db, sqlite, path: filePath };
  return g.__cadenceDb;
}

export function getDb(): Db {
  return openDatabase().db;
}

export function closeDatabase(): void {
  if (!g.__cadenceDb) return;
  try {
    g.__cadenceDb.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // best effort before close
  }
  g.__cadenceDb.sqlite.close();
  g.__cadenceDb = undefined;
}

export { schema };
