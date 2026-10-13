import type { NextRequest } from "next/server";
import { getDb } from "@db/client";
import { deleteForks } from "@relay/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";
import type { DeleteForksResponse } from "@shared/api";

/** Deletes a main chat and every fork of it, in one transaction. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/chats/[id]/delete-all">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const result = await deleteForks(getDb(), getRelay().engine, user.id, id, true);
    if (!result) return jsonError(404, { error: "not_found" });
    return Response.json(result satisfies DeleteForksResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
