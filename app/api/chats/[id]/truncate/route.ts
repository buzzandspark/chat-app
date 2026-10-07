import type { NextRequest } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";

const Body = z.object({ fromMessageId: z.string().uuid() });

/** D10: drops a message and everything after it; running generations for them are stopped first. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/truncate">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const chat = db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, user.id)))
      .get();
    if (!chat) return jsonError(404, { error: "not_found" });
    const from = db
      .select({ position: schema.messages.position })
      .from(schema.messages)
      .where(and(eq(schema.messages.id, parsed.data.fromMessageId), eq(schema.messages.chatId, id)))
      .get();
    if (!from) return jsonError(404, { error: "message_not_found" });
    const victims = db
      .select({ id: schema.messages.id, generationId: schema.messages.generationId })
      .from(schema.messages)
      .where(and(eq(schema.messages.chatId, id), gte(schema.messages.position, from.position)))
      .all();
    const { engine } = getRelay();
    // Settle first: deleting a running generation's rows would strand its buffer and reservation.
    await Promise.all(victims.map((v) => (v.generationId ? engine.stopAndWait(v.generationId) : Promise.resolve())));
    const ids = victims.map((v) => v.id);
    if (ids.length > 0) {
      db.transaction((tx) => {
        tx.delete(schema.generations).where(inArray(schema.generations.messageId, ids)).run();
        tx.delete(schema.messages).where(inArray(schema.messages.id, ids)).run();
        tx.update(schema.chats).set({ updatedAt: new Date() }).where(eq(schema.chats.id, id)).run();
      });
    }
    return Response.json({ removed: ids.length }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
