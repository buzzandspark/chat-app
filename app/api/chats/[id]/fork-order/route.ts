import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@db/client";
import { setForkOrder } from "@relay/forks";
import { MAX_FORKS } from "@shared/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

const Body = z.object({ ids: z.array(z.string().uuid()).max(MAX_FORKS) });

/** The tab strip's drag order for a parent's forks. */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/fork-order">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    if (!setForkOrder(getDb(), user.id, id, parsed.data.ids)) return jsonError(404, { error: "not_found" });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
