import type { NextRequest } from "next/server";
import { getDb } from "@db/client";
import { declareWinner } from "@relay/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { refuseGuestSend } from "@server/ratelimit";
import { getRelay } from "@server/relay";
import type { DeclareWinnerResponse } from "@shared/api";

/** The fork wins: it stays, with its history; the main chat and the other forks are deleted. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/declare-winner">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (user.role === "guest") {
      const refused = refuseGuestSend(request, user.id);
      if (refused) return refused;
    }
    const { engine, options } = getRelay();
    const winner = await declareWinner(getDb(), engine, user.id, id);
    if (!winner) return jsonError(404, { error: "not_found" });
    // Its last reply was skipped while it was a fork: read it now, so the winner can be forked at once.
    const lastMessageId = options.detectLastReply(winner.id, user.id);
    return Response.json({ ...winner, lastMessageId } satisfies DeclareWinnerResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
