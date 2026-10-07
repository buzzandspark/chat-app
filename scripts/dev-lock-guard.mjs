#!/usr/bin/env node
// Refuses to run Next or the harness while this checkout's dev server (.next/dev/lock) is live:
// those runs drive or re-chunk what it serves, and a tab can hit "module factory is not available".
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lockPath = path.join(root, ".next", "dev", "lock");
const what = process.argv.slice(2).join(" ") || "this command";

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

let info = null;
try {
  info = JSON.parse(fs.readFileSync(lockPath, "utf8"));
} catch {
  process.exit(0);
}
if (!info || typeof info.pid !== "number" || !alive(info.pid)) process.exit(0);
if (process.env.CADENCE_ALLOW_SHARED_DEV === "1") {
  console.warn(`[dev-lock-guard] a dev server (pid ${info.pid}, ${info.appUrl}) is live in this checkout; continuing because CADENCE_ALLOW_SHARED_DEV=1`);
  process.exit(0);
}
console.error(`[dev-lock-guard] refusing to run ${what}: a dev server is live in this checkout.`);
console.error(`  pid ${info.pid} on ${info.appUrl}, started ${new Date(info.startedAt).toLocaleTimeString()}`);
console.error(`  Builds, typegen, Playwright and the harness scripts drive or rewrite what that server is serving.`);
console.error(`  Work in a worktree instead:   sh scripts/worktree.sh    (then run the command there)`);
console.error(`  Or stop the dev server, or set CADENCE_ALLOW_SHARED_DEV=1 if you accept the consequences.`);
process.exit(3);
