import "server-only";
import { eq, sql } from "drizzle-orm";
import { env } from "@shared/env";
import { uuidv7 } from "@shared/id";
import { closeDatabase, openDatabase, schema } from "@db/client";
import { runMigrations } from "@db/migrate";
import { seedDevUser } from "@db/seed";
import { costOf } from "@relay/anthropic/pricing";
import { seedAdmin } from "@auth/admin-seed";
import { installSignalHandlers, onShutdown } from "./shutdown";

const g = globalThis as unknown as { __cadenceBooted?: boolean };

export async function boot(): Promise<void> {
  if (g.__cadenceBooted) return;
  g.__cadenceBooted = true;

  runMigrations(env.DATABASE_PATH);
  if (!env.isProd || env.e2e) seedDevUser(env.DEV_USER_ID);
  await seedAdmin(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  backstopInterruptedGenerations();
  installSignalHandlers();
  onShutdown(() => closeDatabase());
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0, environment: env.NODE_ENV });
    onShutdown(() => Sentry.flush(2000).then(() => undefined));
  }

  console.log(
    `[boot] cadence ready (${env.replayMode ? "replay mode" : "live models"}, db=${env.DATABASE_PATH})`,
  );
}

// D3/D22 backstop: a row still `running` at boot died un-drained; mark it interrupted and settle
// an estimated cost from the saved text at four characters per token (no usage was written).
function backstopInterruptedGenerations(): void {
  const { db } = openDatabase(env.DATABASE_PATH);
  const running = db
    .select({
      id: schema.generations.id,
      messageId: schema.generations.messageId,
      chatId: schema.generations.chatId,
      userId: schema.generations.userId,
      requestedModel: schema.generations.requestedModel,
      servingModel: schema.generations.servingModel,
    })
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
      const chatRows = tx
        .select({ id: schema.messages.id, content: schema.messages.content })
        .from(schema.messages)
        .where(eq(schema.messages.chatId, row.chatId))
        .all();
      let inputChars = 0;
      let outputChars = 0;
      for (const m of chatRows) {
        for (const b of m.content) {
          if (b.type !== "text") continue;
          if (m.id === row.messageId) outputChars += b.text.length;
          else inputChars += b.text.length;
        }
      }
      const model = row.servingModel ?? row.requestedModel;
      const tokens = {
        inputTokens: Math.ceil(inputChars / 4),
        outputTokens: Math.ceil(outputChars / 4),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      const costUsd = costOf(model, tokens);
      tx.insert(schema.usageEvents)
        .values({
          id: uuidv7(),
          generationId: row.id,
          userId: row.userId,
          model,
          iterationType: "message",
          ...tokens,
          costUsd,
          estimated: true,
          createdAt: now,
        })
        .run();
      tx.update(schema.users)
        .set({ costSpentUsd: sql`${schema.users.costSpentUsd} + ${costUsd}` })
        .where(eq(schema.users.id, row.userId))
        .run();
    }
  });
  console.warn(`[boot] marked ${running.length} orphaned generation(s) interrupted with estimated cost`);
}
