import type { NextRequest } from "next/server";
import { z } from "zod";
import { BusyError } from "@relay/engine";
import { ForkOptionsBody } from "@relay/options/schema";
import { BudgetExceededError, QuotaExceededError } from "@relay/quota";
import { assertMayInteract, errorResponse, jsonError, requireUser } from "@server/current-user";
import { checkMessageOwner } from "@server/messages";
import { refuseGuestRewrite, tooMany } from "@server/ratelimit";
import { getRelay } from "@server/relay";
import type { RewriteResponse } from "@shared/api";
import { env } from "@shared/env";

const Body = z.object({ instruction: z.string().trim().min(1).max(500), options: ForkOptionsBody });

/** The sheet's instruction for all prompts; the result is returned, not stored (the sheet owns the edits). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/messages/[id]/options/rewrite">): Promise<Response> {
  try {
    const user = await requireUser();
    assertMayInteract(user);
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const owned = checkMessageOwner(user.id, id);
    if (!owned.ok) return jsonError(owned.error === "not_found" ? 404 : 403, { error: owned.error });
    if (user.role === "guest") {
      const refused = refuseGuestRewrite(request, user.id);
      if (refused) return refused;
    }
    try {
      const { options, trace } = await getRelay().options.rewrite(user.id, id, parsed.data.options, parsed.data.instruction);
      return Response.json({ options, trace: env.isProd ? null : trace } satisfies RewriteResponse, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof QuotaExceededError) return jsonError(402, { error: "quota_exceeded", spentUsd: err.spentUsd, capUsd: err.capUsd });
      if (err instanceof BudgetExceededError || err instanceof BusyError) return tooMany(err.retryAfterMs);
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
