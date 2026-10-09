import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";

/** The reply's fork options: stored, or awaited while Haiku is still answering, else null. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/messages/[id]/options">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const row = getDb()
      .select({ userId: schema.chats.userId })
      .from(schema.messages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
      .where(eq(schema.messages.id, id))
      .get();
    if (!row) return jsonError(404, { error: "not_found" });
    if (row.userId !== user.id) return jsonError(403, { error: "forbidden" });
    const options = await getRelay().options.awaitOptions(id, 10_000);
    return Response.json({ options }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
