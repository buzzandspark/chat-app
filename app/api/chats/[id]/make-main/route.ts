import type { NextRequest } from "next/server";
import { getDb } from "@db/client";
import { makeMain } from "@relay/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

/** Promotes a fork to the main chat; the old main becomes one of its forks. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/chats/[id]/make-main">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const made = makeMain(getDb(), user.id, id);
    if (!made) return jsonError(404, { error: "not_found" });
    return Response.json(made, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
