import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { getChatWithMessages } from "@server/chats";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";
import { isUuid } from "@shared/id";

const Patch = z
  .object({ title: z.string().trim().min(1).max(120).optional(), pinned: z.boolean().optional(), tabHidden: z.boolean().optional() })
  .refine((p) => p.title !== undefined || p.pinned !== undefined || p.tabHidden !== undefined);

/** ADR-0005: the rows the page seeds with, for prefetch on intent and the second-tab case; `?all=1` lifts the window. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/chats/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    if (!isUuid(id)) return jsonError(400, { error: "bad_request" });
    const data = getChatWithMessages(id, user.id, { limit: request.nextUrl.searchParams.get("all") === "1" ? null : undefined });
    if (!data) return jsonError(404, { error: "not_found" });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Rename, pin, or close the tab of a chat. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/chats/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const result = db
      .update(schema.chats)
      .set({
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
        ...(parsed.data.tabHidden !== undefined ? { tabHidden: parsed.data.tabHidden } : {}),
      })
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, user.id)))
      .run();
    if (result.changes === 0) return jsonError(404, { error: "not_found" });
    return Response.json({ id, ...parsed.data }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete a chat and, through cascades, its messages, generations and usage rows. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/chats/[id]">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const db = getDb();
    const owned = db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, user.id)))
      .get();
    if (!owned) return jsonError(404, { error: "not_found" });
    // A reply still streaming is stopped and settled before its rows cascade away.
    await getRelay().engine.stopChat(id);
    db.delete(schema.chats).where(eq(schema.chats.id, id)).run();
    return Response.json({ id, deleted: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
