import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";

const Body = z.object({
  sent: z.number(),
  firstByte: z.number().optional(),
  firstPaint: z.number().optional(),
  done: z.number().optional(),
});

/**
 * D20: client-side stamps are stored next to the server's, joined by message
 * id. They are on different clocks and are never compared across machines.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/messages/[id]/timings">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const row = db
      .select({ timings: schema.messages.timings, userId: schema.chats.userId })
      .from(schema.messages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
      .where(eq(schema.messages.id, id))
      .get();
    if (!row) return jsonError(404, { error: "not_found" });
    if (row.userId !== user.id) return jsonError(403, { error: "forbidden" });
    const timings = { ...(row.timings ?? {}), client: { ...(row.timings?.client ?? {}), ...parsed.data } };
    db.update(schema.messages).set({ timings }).where(eq(schema.messages.id, id)).run();
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
