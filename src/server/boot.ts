import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@shared/env";
import { closeDatabase, openDatabase, schema } from "@db/client";
import { runMigrations } from "@db/migrate";
import { seedDevUser } from "@db/seed";
import { installSignalHandlers, onShutdown } from "./shutdown";

const g = globalThis as unknown as { __cadenceBooted?: boolean };

export async function boot(): Promise<void> {
  if (g.__cadenceBooted) return;
  g.__cadenceBooted = true;

  runMigrations(env.DATABASE_PATH);
  if (!env.isProd || env.e2e) seedDevUser(env.DEV_USER_ID);
  backstopInterruptedGenerations();
  installSignalHandlers();
  onShutdown(() => closeDatabase());

  console.log(
    `[boot] cadence ready (${env.replayMode ? "replay mode" : "live models"}, db=${env.DATABASE_PATH})`,
  );
}

/**
 * Boot backstop (D3): a row still `running` at boot means the previous process
 * died without draining. Mark it interrupted so resume returns a snapshot
 * instead of waiting for events that will never come. Cost settlement for these
 * rows is wired in step 3/6 (D22).
 */
function backstopInterruptedGenerations(): void {
  const { db } = openDatabase(env.DATABASE_PATH);
  const running = db
    .select({ id: schema.generations.id, messageId: schema.generations.messageId })
    .from(schema.generations)
    .where(eq(schema.generations.status, "running"))
    .all();
  if (running.length === 0) return;
  const now = new Date();
  db.transaction((tx) => {
    for (const row of running) {
      tx.update(schema.generations)
        .set({ status: "interrupted", interruptedReason: "crash", endedAt: now })
        .where(eq(schema.generations.id, row.id))
        .run();
      tx.update(schema.messages)
        .set({ status: "interrupted", updatedAt: now })
        .where(eq(schema.messages.id, row.messageId))
        .run();
    }
  });
  console.warn(`[boot] marked ${running.length} orphaned generation(s) interrupted`);
}
