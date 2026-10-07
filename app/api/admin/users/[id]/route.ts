import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { findUser } from "@server/admin";
import { getRelay } from "@server/relay";

const Patch = z.object({
  costCapUsd: z.number().min(0).max(100_000).nullable().optional(),
  banned: z.boolean().optional(),
  role: z.enum(["admin", "user"]).optional(),
});

/** D7: edit cap, disable/enable (ban), change role. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const user = findUser(id);
    if (!user) return jsonError(404, { error: "not_found" });
    if (id === admin.id && (parsed.data.banned || parsed.data.role === "user")) {
      return jsonError(400, { error: "cannot_demote_self" });
    }
    // A disabled user's running replies stop (and settle) before their sessions go (#69).
    if (parsed.data.banned) await getRelay().engine.stopUser(id);
    const db = getDb();
    const now = new Date();
    db.update(schema.users)
      .set({
        ...(parsed.data.costCapUsd !== undefined ? { costCapUsd: parsed.data.costCapUsd } : {}),
        ...(parsed.data.banned !== undefined ? { banned: parsed.data.banned, banReason: parsed.data.banned ? "Disabled by admin" : null } : {}),
        ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
        updatedAt: now,
      })
      .where(eq(schema.users.id, id))
      .run();
    if (parsed.data.banned) db.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]">): Promise<Response> {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    if (id === admin.id) return jsonError(400, { error: "cannot_delete_self" });
    await getRelay().engine.stopUser(id);
    const result = getDb().delete(schema.users).where(eq(schema.users.id, id)).run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
