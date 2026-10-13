import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@db/client";
import { BusyError, DrainingError, ForbiddenError } from "@relay/engine";
import { createForks, ForkError, ForkStartError } from "@relay/forks";
import { ForkOptionBody } from "@relay/options/schema";
import { BudgetExceededError, QuotaExceededError } from "@relay/quota";
import { readJson, type ApiError, type ForkResponse } from "@shared/api";
import { MAX_FORKS } from "@shared/forks";
import { assertMayInteract, errorResponse, jsonError, requireUser } from "@server/current-user";
import { refuseGuestSend, tooMany } from "@server/ratelimit";
import { getRelay } from "@server/relay";
import { isDraining } from "@server/shutdown";

const Body = z.object({
  /** The reply whose options are explored. */
  messageId: z.string().uuid(),
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
  if (err instanceof BudgetExceededError || err instanceof BusyError) return tooMany(err.retryAfterMs);
  if (err instanceof ForbiddenError) return jsonError(403, { error: "forbidden" });
  if (err instanceof DrainingError) return jsonError(503, { error: "draining" });
  throw err;
}

/** Forks the chat once per option; the model and effort come from the parent's last reply, never the body. Idempotent on the forks' ids. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/chats/[id]/fork">): Promise<Response> {
  try {
    const user = await requireUser();
    assertMayInteract(user);
    const { id } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request", issues: parsed.error.issues });
    if (isDraining()) return jsonError(503, { error: "draining" }, { "retry-after": "5" });
    if (user.role === "guest") {
      const refused = refuseGuestSend(request, user.id);
      if (refused) return refused;
    }
    const { engine, store } = getRelay();
    try {
      const forks = createForks({ db: getDb(), engine, store }, { userId: user.id, userRole: user.role, parentId: id, messageId: parsed.data.messageId, forks: parsed.data.forks });
      return Response.json({ forks } satisfies ForkResponse, { headers: { "cache-control": "no-store" } });
    } catch (err) {
      if (err instanceof ForkError) {
        if (err.code === "not_found") return jsonError(404, { error: "not_found" });
        return jsonError(409, { error: err.code });
      }
      if (err instanceof ForkStartError) {
        const refused = failure(err.reason);
        if (err.started.length === 0) return refused;
        return Response.json({ forks: err.started, failed: await readJson<ApiError>(refused) } satisfies ForkResponse, { headers: { "cache-control": "no-store" } });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
