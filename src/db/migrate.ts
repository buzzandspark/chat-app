import { openDatabase } from "./client";
import { applyMigrations } from "./migrator";

/** Runs at boot (instrumentation.ts) and from `pnpm db:migrate`. */
export function runMigrations(filePath?: string): void {
  const { sqlite } = openDatabase(filePath);
  applyMigrations(sqlite);
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  runMigrations();
  console.log("migrations applied");
}
