import type { NextRequest } from "next/server";
import { getDb } from "@db/client";
import { declareWinner } from "@relay/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";

/** The fork wins: it stays, with its history; the main chat and the other forks are deleted. */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const winner = await declareWinner(getDb(), getRelay().engine, user.id, id);
    if (!winner) return jsonError(404, { error: "not_found" });
    return Response.json(winner, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
