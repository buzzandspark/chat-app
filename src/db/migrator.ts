import path from "node:path";
import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "src/db/migrations");

interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/**
 * Applies pending drizzle-kit migrations with foreign key enforcement off, then checks the result.
 *
 * Why not drizzle's own `migrate()`: it runs every pending migration inside one BEGIN…COMMIT, and
 * SQLite ignores `PRAGMA foreign_keys` inside a transaction, so the `PRAGMA foreign_keys=OFF` that
 * drizzle-kit wraps around a table rebuild is a no-op. The rebuild's `DROP TABLE x` then runs as an
 * implicit DELETE with enforcement on and its ON DELETE CASCADE wipes every child row (dropping
 * `chats` takes all messages and generations with it). The pragma has to be set here, outside the
 * transaction; `PRAGMA foreign_key_check` before COMMIT stands in for the enforcement we turned off,
 * so a migration that leaves a dangling reference rolls back instead of committing it.
 *
 * The journal is drizzle's: the same `__drizzle_migrations` table and rows, files read by drizzle's
 * `readMigrationFiles`, and a migration is pending when its journal `when` is newer than the last
 * recorded one, so a database migrated by either runner carries on under the other.
 */
export function applyMigrations(sqlite: Database.Database, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  const enforced = sqlite.pragma("foreign_keys", { simple: true }) === 1;
  sqlite.pragma("foreign_keys = OFF");
  try {
    // The pragma is silently ignored if this connection is mid-transaction; refuse rather than
    // rebuild tables with cascades live.
    if (sqlite.pragma("foreign_keys", { simple: true }) !== 0) {
      throw new Error("migrations: could not turn foreign key enforcement off (is a transaction open?)");
    }
    // IMMEDIATE takes the write lock before reading the journal, so two processes booting on one
    // file cannot both decide the same migration is pending.
    sqlite
      .transaction(() => {
        sqlite.exec(
          `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
        );
        const last = sqlite
          .prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
          .pluck()
          .get() as number | string | undefined;
        const record = sqlite.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`);
        for (const migration of migrations) {
          if (last !== undefined && Number(last) >= migration.folderMillis) continue;
          for (const statement of migration.sql) sqlite.exec(statement);
          record.run(migration.hash, migration.folderMillis);
        }
        const violations = sqlite.pragma("foreign_key_check") as ForeignKeyViolation[];
        if (violations.length > 0) {
          const sample = violations
            .slice(0, 5)
            .map((v) => `${v.table} rowid ${v.rowid ?? "?"} -> ${v.parent}`)
            .join("; ");
          throw new Error(
            `migrations rolled back: ${violations.length} foreign key violation(s) after applying them (${sample})`,
          );
        }
      })
      .immediate();
  } finally {
    if (enforced) sqlite.pragma("foreign_keys = ON");
  }
}
