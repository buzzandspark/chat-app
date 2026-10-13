import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@shared/env";
import { closeDatabase, getDb, schema } from "@db/client";
import { runMigrations } from "@db/migrate";
import { seedDevUser } from "@db/seed";
import { seedAdmin } from "@auth/admin-seed";
import { DEV_AUTH_SECRET } from "@auth/server";
import { settleOrphan } from "@relay/orphans";
import { redactInviteTokens } from "@shared/redact";
import { startGuestPurge } from "./guests";
import { createQuota } from "./relay";
import { installSignalHandlers, onShutdown } from "./shutdown";

const g = globalThis as unknown as { __chatBooted?: boolean };

export async function boot(): Promise<void> {
  if (g.__chatBooted) return;
  g.__chatBooted = true;

  if (env.isProd && !env.BETTER_AUTH_SECRET) {
    // Without it better-auth fails every auth call while /api/health stays green, and with TEST set
    // it signs sessions with its public default secret instead. Fail the deploy rather than either.
    console.error("[boot] BETTER_AUTH_SECRET is not set; refusing to start. Set it to a long random string (openssl rand -base64 32).");
    process.exit(1);
  }
  if (env.isProd && env.e2e && !env.e2eAllowProduction) {
    // E2E skips the login redirect, runs every cookieless request as DEV_USER_ID (seeded below, no
    // cost cap) and turns off the sign-in rate limit. Only the test harness may combine it with production.
    console.error("[boot] E2E is set in production; refusing to start. Unset E2E, or set E2E_ALLOW_PRODUCTION=1 if this is the e2e harness.");
    process.exit(1);
  }
  const misconfigured = env.isProd && !env.e2e ? deployProblem() : null;
  if (misconfigured) {
    console.error(`[boot] ${misconfigured}; refusing to start.`);
    process.exit(1);
  }
  runMigrations(env.DATABASE_PATH);
  if (!env.isProd || env.e2e) seedDevUser(env.DEV_USER_ID);
  await seedAdmin(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  backstopInterruptedGenerations();
  startGuestPurge();
  installSignalHandlers();
  onShutdown(() => closeDatabase(), "close");
  if (env.SENTRY_DSN) {
    const Sentry = await import("@sentry/node");
    // The HTTP integration puts the request URL and headers (a `referer` too) on every event and breadcrumb;
    // an invite token among them is a password-setting credential.
    Sentry.init({
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 0,
      // Sentry's defaults send request bodies (passwords, messages), cookies (the session), headers and the client IP.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
      },
      environment: env.NODE_ENV,
      beforeSend: redactInviteTokens,
      beforeSendTransaction: redactInviteTokens,
      beforeBreadcrumb: redactInviteTokens,
    });
    onShutdown(() => Sentry.flush(2000).then(() => undefined));
  }

  console.log(
    `[boot] chat ready (${env.replayMode ? "replay mode" : "live models"}, db=${env.DATABASE_PATH})`,
  );
}

// The .env.example placeholder and the development fallback sign sessions anyone could forge.
const PUBLIC_SECRETS = new Set(["change-me-to-a-long-random-string", DEV_AUTH_SECRET]);

function deployProblem(): string | null {
  if (!env.BETTER_AUTH_URL) return "BETTER_AUTH_URL is not set. Set it to the URL users reach the app at";
  if (!env.ANTHROPIC_API_KEY && !env.replayRequested) {
    return "ANTHROPIC_API_KEY is not set. Set it, or set REPLAY_MODE=1 to serve recorded replies";
  }
  if (env.BETTER_AUTH_SECRET && PUBLIC_SECRETS.has(env.BETTER_AUTH_SECRET)) {
    return "BETTER_AUTH_SECRET is a published placeholder. Generate one with openssl rand -base64 32";
  }
  if (env.ADMIN_PASSWORD !== undefined && (env.ADMIN_PASSWORD === "change-me" || env.ADMIN_PASSWORD.length < 10)) {
    return "ADMIN_PASSWORD is the placeholder or shorter than 10 characters";
  }
  return null;
}

// Backstop: a row still `running` at boot died un-drained; mark it interrupted and settle an estimated
// cost from the saved text (zero for a scripted or replayed run).
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
  const quota = createQuota(db);
  db.transaction((tx) => {
    for (const row of running) settleOrphan(tx, row, now, quota);
  });
  console.warn(`[boot] marked ${running.length} orphaned generation(s) interrupted with estimated cost`);
}

