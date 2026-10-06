import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { issueInvite } from "@auth/invites";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";
import { env } from "@shared/env";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { listUsersForAdmin } from "@server/admin";

const Body = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().max(100).optional(),
  costCapUsd: z.number().min(0).max(100_000).nullable().optional(),
});

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    return Response.json({ users: listUsersForAdmin() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** D7, D23: create a user without a password and issue the first invite link. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const email = parsed.data.email.toLowerCase();
    if (db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) {
      return jsonError(409, { error: "email_taken" });
    }
    const id = uuidv7();
    const now = new Date();
    db.insert(schema.users)
      .values({
        id,
        email,
        name: parsed.data.name || (email.split("@")[0] ?? "user"),
        emailVerified: false,
        role: "user",
        costCapUsd: parsed.data.costCapUsd ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const invite = issueInvite(id);
    const base = env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json(
      { id, inviteUrl: `${base}/invite/${invite.token}`, expiresAt: invite.expiresAt.getTime() },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
