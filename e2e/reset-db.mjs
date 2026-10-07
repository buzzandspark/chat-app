// Each run starts from an empty database so titles and counts are deterministic. This runs as the
// first half of the web server command: Playwright starts the server before globalSetup, so a reset
// there deleted the file under a running server (new connections saw an empty, unlinked database).
import fs from "node:fs";
import path from "node:path";

const db = path.resolve(process.cwd(), "data/e2e.db");
fs.mkdirSync(path.dirname(db), { recursive: true });
for (const f of [db, `${db}-wal`, `${db}-shm`]) fs.rmSync(f, { force: true });
