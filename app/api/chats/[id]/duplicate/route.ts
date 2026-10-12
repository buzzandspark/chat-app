import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@db/client";
import { duplicateChat, ForkError } from "@relay/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

const Body = z.object({ chatId: z.string().uuid(), messageId: z.string().uuid() });

/** A reply's "Duplicate chat": `chatId` is the new fork's id (client-chosen, ADR-0005), `messageId` the reply it ends on. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/duplicate">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    try {
      const duplicate = duplicateChat(getDb(), { userId: user.id, chatId: id, messageId: parsed.data.messageId, newChatId: parsed.data.chatId });
      return Response.json(duplicate, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof ForkError) return err.code === "not_found" ? jsonError(404, { error: "not_found" }) : jsonError(409, { error: err.code });
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
