import "server-only";
import { z } from "zod";
import { DefaultCapEnvSchema } from "./cost-cap-schema";

/** A blank `KEY=` line means the default, not 0. */
const blankAsUnset = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ANTHROPIC_API_KEY: z.string().optional(),
  DATABASE_PATH: z.string().default("data/app.db"),
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  ADMIN_EMAIL: z.string().trim().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_PATH_SLUG: z.string().regex(/^[a-z0-9-]+$/).default("admin"),
  /** USD cap for an invited user when the admin leaves the field blank (ADR-0004). */
  DEFAULT_COST_CAP_USD: DefaultCapEnvSchema,
  /** USD cap for a guest (an anonymous visitor on Haiku). */
  GUEST_COST_CAP_USD: z.preprocess(blankAsUnset, z.coerce.number().positive().max(100).default(0.1)),
  /** USD a day that the guests from one address (an IPv6 /64), from one IPv6 /48, and all guests together may spend. */
  GUEST_IP_USD_PER_DAY: z.preprocess(blankAsUnset, z.coerce.number().positive().default(1)),
  GUEST_IP48_USD_PER_DAY: z.preprocess(blankAsUnset, z.coerce.number().positive().default(3)),
  GUEST_ALL_USD_PER_DAY: z.preprocess(blankAsUnset, z.coerce.number().positive().default(10)),
  /** The largest prompt a guest may send, in tokens estimated at 2.5 UTF-8 bytes each; the default keeps natural text in any script under Haiku's long-context tier at 100k. */
  GUEST_MAX_PROMPT_TOKENS: z.preprocess(blankAsUnset, z.coerce.number().int().positive().max(100_000).default(60_000)),
  DEV_USER_ID: z.string().default("dev-user"),
  REPLAY_MODE: z.string().optional(),
  RECORD: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  E2E: z.string().optional(),
  E2E_ALLOW_PRODUCTION: z.string().optional(),
});

function flag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

// No checks with side effects here: `next build` evaluates this module while collecting page data, with
// NODE_ENV=production and none of the runtime's variables, so a warning here fires in every build log.
// Runtime requirements are enforced by boot().
const parsed = schema.parse(process.env);

export const env = {
  ...parsed,
  isProd: parsed.NODE_ENV === "production",
  isDev: parsed.NODE_ENV === "development",
  /** A missing key or REPLAY_MODE=1 boots the whole app in replay mode. */
  replayMode: flag(parsed.REPLAY_MODE) || !parsed.ANTHROPIC_API_KEY,
  record: flag(parsed.RECORD),
  e2e: flag(parsed.E2E),
  /** The e2e harness runs the standalone (production) server with E2E set; nothing else should. */
  e2eAllowProduction: flag(parsed.E2E_ALLOW_PRODUCTION),
};
