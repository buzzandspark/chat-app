import "server-only";
import { eq, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous } from "better-auth/plugins";
import { getDb, schema } from "@db/client";
import { env } from "@shared/env";
import { CLIENT_ADDRESS_HEADER } from "@server/client-address";

export const DEV_AUTH_SECRET = "dev-secret-not-for-production-0123456789";

/** Production never falls through to better-auth's own fallbacks, which include a public default secret. */
function authSecret(): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (env.isProd) throw new Error("BETTER_AUTH_SECRET is not set");
  return DEV_AUTH_SECRET;
}

/** Moves a guest's chats, replies and spend to the account it signed in to, before the guest is deleted. */
async function adoptGuest(guestId: string, userId: string): Promise<void> {
  // A reply still streaming would finish under the deleted guest (and its usage insert would fail): settle it first.
  const { getRelay } = await import("@server/relay");
  await getRelay().engine.stopUser(guestId);
  const db = getDb();
  db.transaction((tx) => {
    // The spend moves with the usage rows, so the account's cap counts what its usage table shows.
    const guest = tx.select({ spent: schema.users.costSpentUsd }).from(schema.users).where(eq(schema.users.id, guestId)).get();
    if (guest && guest.spent > 0) {
      tx.update(schema.users).set({ costSpentUsd: sql`${schema.users.costSpentUsd} + ${guest.spent}` }).where(eq(schema.users.id, userId)).run();
    }
    tx.update(schema.chats).set({ userId }).where(eq(schema.chats.userId, guestId)).run();
    tx.update(schema.generations).set({ userId }).where(eq(schema.generations.userId, guestId)).run();
    tx.update(schema.usageEvents).set({ userId }).where(eq(schema.usageEvents.userId, guestId)).run();
  });
}

/**
 * ADR-0004: email + password with sign-up disabled, admin plugin for roles and bans, and an anonymous
 * guest for every visitor without a session (created only by /api/guest).
 */
function createAuth() {
  const adminPlugin = admin({
    defaultRole: "user",
    adminRoles: ["admin"],
    bannedUserMessage: "This account is disabled. Ask the admin to re-enable it.",
  });
  return betterAuth({
    appName: "Chat",
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: authSecret(),
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      usePlural: true,
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
    },
    // better-auth's per-IP limiter (3 sign-ins per 10 s) stays on in production;
    // the e2e harness signs in several users from one address in seconds.
    rateLimit: { enabled: env.isProd && !env.e2e },
    // better-auth's sign-in limiter and sessions.ip_address read the address our own limits use, which the proxy sets.
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    databaseHooks: {
      user: {
        create: {
          // Anonymous users are guests whatever created them: Haiku only, under the guest cap.
          before: async (user) =>
            (user as { isAnonymous?: boolean }).isAnonymous === true
              ? { data: { ...user, role: "guest", name: "Guest", costCapUsd: env.GUEST_COST_CAP_USD } }
              : { data: user },
        },
      },
    },
    user: {
      additionalFields: {
        costCapUsd: { type: "number", required: false, input: false },
        costSpentUsd: { type: "number", required: false, input: false },
      },
    },
    // The admin plugin is here for its schema and its hook refusing a banned sign-in. Its HTTP endpoints stay off:
    // app/api/admin/users enforces the cost cap, the self-demotion guard and stopping a banned user's generations.
    disabledPaths: Object.values(adminPlugin.endpoints).map((endpoint) => endpoint.path),
    plugins: [
      adminPlugin,
      anonymous({
        emailDomainName: "guest.invalid",
        onLinkAccount: ({ anonymousUser, newUser }) => adoptGuest(anonymousUser.user.id, newUser.user.id),
      }),
      nextCookies(),
    ],
  });
}

const g = globalThis as unknown as { __chatAuth?: ReturnType<typeof createAuth> };
export function getAuth(): ReturnType<typeof createAuth> {
  g.__chatAuth ??= createAuth();
  return g.__chatAuth;
}

export const SESSION_COOKIE = "better-auth.session_token";
