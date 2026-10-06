import "server-only";
import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb, schema } from "@db/client";
import { env } from "@shared/env";
import type { UserRole } from "@shared/types";

export interface CurrentUser {
  id: string;
  role: UserRole;
  email: string;
  name: string;
}

/**
 * Build steps 2 to 5 run against the seeded dev user (D6); step 6 replaces
 * this with better-auth's `auth.api.getSession`, validated once per request
 * and once per SSE connection.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  // better-sqlite3 is synchronous, so nothing before this line signals
  // "request time" to the prerenderer; `connection()` does, which keeps the
  // database out of the build and the shell static (D21).
  await connection();
  const db = getDb();
  const row = db
    .select({ id: schema.users.id, role: schema.users.role, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, env.DEV_USER_ID))
    .get();
  return row ?? null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? status));
    this.name = "HttpError";
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, { error: "unauthorized" });
  return user;
}

export function jsonError(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.status, err.body);
  console.error("[route] unhandled", err);
  return jsonError(500, { error: "internal" });
}
