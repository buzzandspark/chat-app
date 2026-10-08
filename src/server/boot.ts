import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@shared/env";
import { closeDatabase, getDb, schema } from "@db/client";
import { runMigrations } from "@db/migrate";
import { seedDevUser } from "@db/seed";
import { seedAdmin } from "@auth/admin-seed";
import { settleOrphan } from "@relay/orphans";
import { redactInviteTokens } from "@shared/redact";
import { installSignalHandlers, onShutdown } from "./shutdown";

const g = globalThis as unknown as { __cadenceBooted?: boolean };

export async function boot(): Promise<void> {
  if (g.__cadenceBooted) return;
  g.__cadenceBooted = true;

  if (env.isProd && !env.BETTER_AUTH_SECRET) {
    // Without it better-auth fails every auth call while /api/health stays green, and with TEST set
    // it signs sessions with its public default secret instead. Fail the deploy rather than either.
    console.error("[boot] BETTER_AUTH_SECRET is not set; refusing to start. Set it to a long random string (openssl rand -base64 32).");
    process.exit(1);
  }
  runMigrations(env.DATABASE_PATH);
  if (!env.isProd || env.e2e) seedDevUser(env.DEV_USER_ID);
  await seedAdmin(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  backstopInterruptedGenerations();
  installSignalHandlers();
  onShutdown(() => closeDatabase(), "close");
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    // The HTTP integration puts the request URL and headers (a `referer` too) on every event and breadcrumb;
    // an invite token among them is a password-setting credential.
    Sentry.init({
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 0,
      environment: env.NODE_ENV,
      beforeSend: redactInviteTokens,
      beforeSendTransaction: redactInviteTokens,
      beforeBreadcrumb: redactInviteTokens,
    });
    onShutdown(() => Sentry.flush(2000).then(() => undefined));
  }

  console.log(
    `[boot] cadence ready (${env.replayMode ? "replay mode" : "live models"}, db=${env.DATABASE_PATH})`,
  );
}

// D3/D22 backstop: a row still `running` at boot died un-drained; mark it interrupted and settle
// an estimated cost from the saved text at four characters per token (no usage was written), zero
// for a scripted or replayed run.
function backstopInterruptedGenerations(): void {
  const db = getDb();
  const running = db
    .select({
      id: schema.generations.id,
      messageId: schema.generations.messageId,
      chatId: schema.generations.chatId,
      userId: schema.generations.userId,
      requestedModel: schema.generations.requestedModel,
      provider: schema.generations.provider,
    })
    .from(schema.generations)
    .where(eq(schema.generations.status, "running"))
    .all();
  if (running.length === 0) return;
  const now = new Date();
  db.transaction((tx) => {
    for (const row of running) settleOrphan(tx as unknown as typeof db, row, now);
  });
  console.warn(`[boot] marked ${running.length} orphaned generation(s) interrupted with estimated cost`);
}

