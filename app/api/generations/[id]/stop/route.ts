import type { NextRequest } from "next/server";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";

/** Stop is explicit: aborts upstream and appends `stopped`. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/generations/[id]/stop">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { engine } = getRelay();
    const owner = engine.owner(id);
    if (owner === null) return jsonError(404, { error: "not_found" });
    if (owner !== user.id) return jsonError(403, { error: "forbidden" });
    const stopped = engine.stop(id);
    return Response.json({ stopped }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
