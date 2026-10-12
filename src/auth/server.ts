import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { getDb, schema } from "@db/client";
import { env } from "@shared/env";

/** Production never falls through to better-auth's own fallbacks, which include a public default secret. */
function authSecret(): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (env.isProd) throw new Error("BETTER_AUTH_SECRET is not set");
  return "dev-secret-not-for-production-0123456789";
}

/** ADR-0004 (amended 2026-10-07): email + password with sign-up disabled, admin plugin for roles and bans; no anonymous path. */
function createAuth() {
  const adminPlugin = admin({ defaultRole: "user", adminRoles: ["admin"] });
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
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        costCapUsd: { type: "number", required: false, input: false },
        costSpentUsd: { type: "number", required: false, input: false },
      },
    },
    // The admin plugin is here for its schema (role, banned, ban_reason) and its hook that refuses a
    // banned user's sign-in. Its HTTP endpoints (/admin/create-user, set-role, ban-user, impersonate-user…)
    // stay off: user management goes through app/api/admin/users, which enforces the cost cap, the
    // self-demotion guard and stopping a banned user's generations. Server-side auth.api calls are unaffected.
    disabledPaths: Object.values(adminPlugin.endpoints).map((endpoint) => endpoint.path),
    plugins: [adminPlugin, nextCookies()],
  });
}

const g = globalThis as unknown as { __chatAuth?: ReturnType<typeof createAuth> };
export function getAuth(): ReturnType<typeof createAuth> {
  g.__chatAuth ??= createAuth();
  return g.__chatAuth;
}

export type Auth = ReturnType<typeof createAuth>;
export const SESSION_COOKIE = "better-auth.session_token";
