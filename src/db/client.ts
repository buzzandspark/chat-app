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

// One connection per process, cached on globalThis so dev HMR does not open a new handle on every reload.
const g = globalThis as unknown as { __chatDb?: DbHandle };

export function openDatabase(filePath: string = process.env.DATABASE_PATH ?? "data/app.db"): DbHandle {
  if (g.__chatDb && g.__chatDb.path === filePath) return g.__chatDb;
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  // SQLite's lower() folds ASCII only; search needs the same folding as the query (JavaScript's).
  sqlite.function("unicode_lower", { deterministic: true }, (value: unknown) => (typeof value === "string" ? value.toLowerCase() : value));
  const db = drizzle(sqlite, { schema });
  g.__chatDb = { db, sqlite, path: filePath };
  return g.__chatDb;
}

export function getDb(): Db {
  return openDatabase().db;
}

export function closeDatabase(): void {
  if (!g.__chatDb) return;
  try {
    g.__chatDb.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // best effort before close
  }
  g.__chatDb.sqlite.close();
  g.__chatDb = undefined;
}

export { schema };
