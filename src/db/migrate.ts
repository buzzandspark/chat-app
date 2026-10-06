import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "./client";

/** Runs at boot (instrumentation.ts) and from `pnpm db:migrate`. */
export function runMigrations(filePath?: string): void {
  const { db } = openDatabase(filePath);
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations();
  console.log("migrations applied");
}
