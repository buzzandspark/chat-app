import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, anonymous } from "better-auth/plugins";
import { getDb, schema } from "@db/client";
import { env } from "@shared/env";

/** ADR-0004: email + password with sign-up disabled, admin plugin for roles/bans, anonymous plugin for demo visitors. */
function createAuth() {
  return betterAuth({
    appName: "Cadence",
    baseURL: env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: env.BETTER_AUTH_SECRET ?? (env.isProd ? undefined : "dev-secret-not-for-production-0123456789"),
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
    databaseHooks: {
      user: {
        create: {
          // Anonymous users are demo visitors whatever path created them: replay only, purged after 24 h.
          before: async (user) => {
            const anon = (user as { isAnonymous?: boolean }).isAnonymous === true;
            return anon ? { data: { ...user, role: "demo", name: "Demo visitor" } } : { data: user };
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      anonymous({ emailDomainName: "demo.cadence.invalid" }),
      nextCookies(),
    ],
  });
}

const g = globalThis as unknown as { __cadenceAuth?: ReturnType<typeof createAuth> };
export function getAuth(): ReturnType<typeof createAuth> {
  g.__cadenceAuth ??= createAuth();
  return g.__cadenceAuth;
}

export type Auth = ReturnType<typeof createAuth>;
export const SESSION_COOKIE = "better-auth.session_token";
