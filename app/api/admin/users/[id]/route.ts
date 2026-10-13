import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { deleteUser, findUser, updateUser } from "@server/admin";
import { getRelay } from "@server/relay";
import type { OkResponse } from "@shared/api";
import { CapFieldSchema } from "@shared/cost-cap-schema";

const Patch = z.object({
  // Omitted leaves the cap alone; "none" clears it, and `null` is refused like on create.
  costCapUsd: CapFieldSchema.optional(),
  banned: z.boolean().optional(),
  role: z.enum(["admin", "user"]).optional(),
});

/** Edit cap, disable/enable (ban), change role. */
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
    if (parsed.data.banned) await getRelay().engine.stopUser(id);
    updateUser(id, parsed.data);
    return Response.json({ ok: true } satisfies OkResponse, { headers: { "cache-control": "no-store" } });
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
    if (!deleteUser(id)) return jsonError(404, { error: "not_found" });
    return Response.json({ ok: true } satisfies OkResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
