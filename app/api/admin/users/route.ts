import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { issueInvite } from "@auth/invites";
import { getDb, schema } from "@db/client";
import type { AdminUsersResponse, CreateUserResponse } from "@shared/api";
import { uuidv7 } from "@shared/id";
import { env } from "@shared/env";
import { newUserCap } from "@shared/cost-cap";
import { CapFieldSchema } from "@shared/cost-cap-schema";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { listUsersForAdmin } from "@server/admin";

const Body = z.object({
  email: z.string().email().max(200),
  name: z.string().trim().max(100).optional(),
  // Omitted means DEFAULT_COST_CAP_USD; only "none" stores no cap (ADR-0004: every invited user is capped).
  costCapUsd: CapFieldSchema.optional(),
});

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    return Response.json({ users: listUsersForAdmin() } satisfies AdminUsersResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Creates a user without a password and issues the first invite link. */
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
        costCapUsd: newUserCap(parsed.data.costCapUsd, env.DEFAULT_COST_CAP_USD),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const invite = issueInvite(id);
    const base = env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json(
      { id, inviteUrl: `${base}/invite/${invite.token}`, expiresAt: invite.expiresAt.getTime() } satisfies CreateUserResponse,
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
