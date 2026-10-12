import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@db/client";
import { DrainingError, ForbiddenError } from "@relay/engine";
import { createForks, ForkError, ForkStartError } from "@relay/forks";
import { ForkOptionBody } from "@relay/options/schema";
import { BudgetExceededError, PromptTooLongError, QuotaExceededError } from "@relay/quota";
import { MAX_FORKS } from "@shared/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { tooMany } from "@server/ratelimit";
import { getRelay } from "@server/relay";
import { isDraining } from "@server/shutdown";

const Body = z.object({
  forks: z
    .array(
      ForkOptionBody.extend({
        chatId: z.string().uuid(),
        generationId: z.string().uuid(),
        userMessageId: z.string().uuid(),
        assistantMessageId: z.string().uuid(),
      }),
    )
    .min(1)
    .max(MAX_FORKS),
});

function failure(err: unknown): Response {
  if (err instanceof QuotaExceededError) return jsonError(402, { error: "quota_exceeded", spentUsd: err.spentUsd, capUsd: err.capUsd });
  if (err instanceof PromptTooLongError) return jsonError(413, { error: "context_full" });
  if (err instanceof BudgetExceededError) return tooMany(err.retryAfterMs);
  if (err instanceof ForbiddenError) return jsonError(403, { error: "forbidden" });
  if (err instanceof DrainingError) return jsonError(503, { error: "draining" });
  throw err;
}

/** Forks the chat once per option; the model and effort come from the parent's last reply, never the body. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/fork">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request", issues: parsed.error.issues });
    if (isDraining()) return jsonError(503, { error: "draining" }, { "retry-after": "5" });
    const { engine, store } = getRelay();
    try {
      const forks = createForks({ db: getDb(), engine, store }, { userId: user.id, userRole: user.role, parentId: id, forks: parsed.data.forks });
      return Response.json({ forks }, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof ForkError) {
        if (err.code === "not_found") return jsonError(404, { error: "not_found" });
        return jsonError(409, { error: err.code });
      }
      if (err instanceof ForkStartError) {
        const refused = failure(err.reason);
        if (err.started.length === 0) return refused;
        return Response.json({ forks: err.started, failed: await refused.json() }, { headers: { "cache-control": "no-store" } });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
