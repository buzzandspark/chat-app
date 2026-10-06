import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

const Patch = z.object({ title: z.string().trim().min(1).max(120) });

/** Rename a chat (D19 rename sheet). */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/chats/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const result = db
      .update(schema.chats)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, user.id)))
      .run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ id, title: parsed.data.title }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete a chat and, through cascades, its messages, generations and usage rows. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/chats/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const db = getDb();
    const result = db
      .delete(schema.chats)
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, user.id)))
      .run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ id, deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
