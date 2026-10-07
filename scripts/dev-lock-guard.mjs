#!/usr/bin/env node
/**
 * Refuses to run Next or the harness in a checkout whose dev server is live.
 *
 * Next 16 keeps one dev server per checkout (`.next/dev/lock`). Running
 * `next build`, `next typegen`, Playwright, the screenshot pass or the
 * shutdown script in the same checkout does not delete `.next/dev` (build
 * cleaning skips it), but every one of them drives that server or rewrites
 * the sources it is watching: a document load that lands during one of its
 * recompiles can receive a chunk list that no longer matches the module
 * graph, which the browser reports as "module factory is not available".
 * Agents and scripts work in a git worktree with their own dev server
 * (scripts/worktree.sh); the developer's checkout belongs to the developer.
 */
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
