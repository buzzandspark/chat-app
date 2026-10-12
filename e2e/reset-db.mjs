// Empties the database before the web server starts; globalSetup runs after Playwright starts the
// server, so a reset there would delete the file under a running server.
import fs from "node:fs";
import path from "node:path";

const db = path.resolve(process.cwd(), "data/e2e.db");
fs.mkdirSync(path.dirname(db), { recursive: true });
for (const f of [db, `${db}-wal`, `${db}-shm`]) fs.rmSync(f, { force: true });
