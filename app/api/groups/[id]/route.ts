import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

const Patch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), collapsed: z.boolean().optional() })
  .refine((p) => p.name !== undefined || p.collapsed !== undefined);

/** Rename a group or remember whether it is collapsed. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/groups/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const result = getDb()
      .update(schema.chatGroups)
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.collapsed !== undefined ? { collapsed: parsed.data.collapsed } : {}),
      })
      .where(and(eq(schema.chatGroups.id, id), eq(schema.chatGroups.userId, user.id)))
      .run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ id, ...parsed.data }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete a group; its chats stay and become ungrouped (the foreign key sets their group to null). */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/groups/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = getDb()
      .delete(schema.chatGroups)
      .where(and(eq(schema.chatGroups.id, id), eq(schema.chatGroups.userId, user.id)))
      .run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ id, deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
