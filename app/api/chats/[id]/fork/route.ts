import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@db/client";
import { DrainingError, ForbiddenError } from "@relay/engine";
import { createForks, ForkError, ForkStartError } from "@relay/forks";
import { ForkOptionBody } from "@relay/options/schema";
import { QuotaExceededError } from "@relay/quota";
import { MAX_FORKS } from "@shared/forks";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
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

function failure(err: unknown): { status: number; body: Record<string, unknown> } {
  if (err instanceof QuotaExceededError) return { status: 402, body: { error: "quota_exceeded", spentUsd: err.spentUsd, capUsd: err.capUsd } };
  if (err instanceof ForbiddenError) return { status: 403, body: { error: "forbidden" } };
  if (err instanceof DrainingError) return { status: 503, body: { error: "draining" } };
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
        const { status, body } = failure(err.reason);
        if (err.started.length === 0) return jsonError(status, body);
        return Response.json({ forks: err.started, failed: body }, { headers: { "cache-control": "no-store" } });
      }
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
