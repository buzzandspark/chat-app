import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { ForkOptionsBody } from "@relay/options/schema";
import { QuotaExceededError } from "@relay/quota";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";
import { env } from "@shared/env";

const Body = z.object({ instruction: z.string().trim().min(1).max(500), options: ForkOptionsBody });

/** The sheet's instruction for all prompts; the result is returned, not stored (the sheet owns the edits). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[id]/options/rewrite">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const row = getDb()
      .select({ userId: schema.chats.userId })
      .from(schema.messages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
      .where(eq(schema.messages.id, id))
      .get();
    if (!row) return jsonError(404, { error: "not_found" });
    if (row.userId !== user.id) return jsonError(403, { error: "forbidden" });
    try {
      const { options, trace } = await getRelay().options.rewrite(user.id, id, parsed.data.options, parsed.data.instruction);
      return Response.json({ options, trace: env.isProd ? null : trace }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof QuotaExceededError) return jsonError(402, { error: "quota_exceeded", spentUsd: err.spentUsd, capUsd: err.capUsd });
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
