import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getAuth, SESSION_COOKIE } from "@auth/server";
import { getDb, schema } from "@db/client";
import type { ApiError } from "@shared/api";
import { env } from "@shared/env";
import type { UserRole } from "@shared/types";
import { guestsBlocked } from "./instance-settings";

export interface CurrentUser {
  id: string;
  role: UserRole;
  email: string;
  name: string;
}

// ADR-0004: validated through better-auth once per request. Without a session only the e2e harness
// falls back to the seeded dev user; everyone else is sent to become a guest first (proxy.ts).
/** For pages and layouts, which can't set cookies: the daily session refresh is left to route handlers (`requireUser`). */
export function getCurrentUser(): Promise<CurrentUser | null> {
  return currentUser(false);
}

async function currentUser(refresh: boolean): Promise<CurrentUser | null> {
  // better-sqlite3 is synchronous, so only `connection()` tells the prerenderer this is request
  // time; it keeps the database out of the build and the shell static.
  await connection();
  const reqHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: reqHeaders, query: { disableRefresh: !refresh } });
  if (session?.user) {
    const u = session.user as { id: string; email: string; name: string; role?: string | null; banned?: boolean | null };
    if (u.banned) return null;
    const role: UserRole = u.role === "admin" ? "admin" : u.role === "guest" ? "guest" : "user";
    touchLastActive(u.id);
    return { id: u.id, role, email: u.email, name: u.name };
  }
  if (!env.e2e) return null;
  // A cookie that no longer matches a session is an expired or revoked sign-in, not an anonymous
  // visit: the development and harness fallback applies only when there is no session cookie at all.
  if (reqHeaders.get("cookie")?.includes(SESSION_COOKIE)) return null;
  const db = getDb();
  const row = db
    .select({ id: schema.users.id, role: schema.users.role, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, env.DEV_USER_ID))
    .get();
  return row ?? null;
}

const lastTouched = new Map<string, number>();
/** `users.last_active_at`, written at most once a minute per user. */
function touchLastActive(userId: string): void {
  const now = Date.now();
  if ((lastTouched.get(userId) ?? 0) > now - 60_000) return;
  lastTouched.set(userId, now);
  try {
    getDb().update(schema.users).set({ lastActiveAt: new Date(now) }).where(eq(schema.users.id, userId)).run();
  } catch {
    // best effort
  }
}

/** Scenarios (scripted replies, the long-chat seed) write rows for free: in production only signed-in users and the e2e harness run them. */
export function scenariosAllowed(role: UserRole): boolean {
  return !env.isProd || env.e2e || role !== "guest";
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new HttpError(404, { error: "not_found" });
  return user;
}

/** While guests are blocked a guest still reads its chats but starts nothing new. */
export function assertMayInteract(user: CurrentUser): void {
  if (user.role === "guest" && guestsBlocked()) throw new HttpError(403, { error: "guests_blocked" });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(String(body.error ?? status));
    this.name = "HttpError";
  }
}

/** For route handlers, where a refreshed session's new cookie reaches the browser. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser(true);
  if (!user) throw new HttpError(401, { error: "unauthorized" });
  return user;
}

export function jsonError(status: number, body: ApiError, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function errorResponse(err: unknown): Response {
  // Next's own control-flow errors (prerender interrupts from `connection()`,
  // redirects, notFound) must propagate, or a static route prerenders as a 500.
  unstable_rethrow(err);
  if (err instanceof HttpError) return jsonError(err.status, err.body);
  console.error("[route] unhandled", err);
  if (env.SENTRY_DSN) void import("@sentry/node").then((Sentry) => Sentry.captureException(err));
  return jsonError(500, { error: "internal" });
}
