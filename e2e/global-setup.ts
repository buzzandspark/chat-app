import fs from "node:fs";
import path from "node:path";

/** Each run starts from an empty database so titles and counts are deterministic. */
export default function globalSetup(): void {
  const db = path.resolve(process.cwd(), "data/e2e.db");
  for (const f of [db, `${db}-wal`, `${db}-shm`]) fs.rmSync(f, { force: true });
}
