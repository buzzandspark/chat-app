import type { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { DrainingError, ForbiddenError } from "@relay/engine";
import { QuotaExceededError } from "@relay/quota";
import { SCENARIO_NAMES, SCENARIOS } from "@relay/scenarios";
import { MODEL_IDS } from "@shared/models";
import { MAX_MESSAGE_CHARS } from "@shared/types";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";
import { isDraining } from "@server/shutdown";
import { singleEventResponse, streamGeneration } from "@server/sse-response";

const MAX_RUNNING_PER_USER = 3;

const Body = z.object({
  chatId: z.string().uuid(),
  generationId: z.string().uuid(),
  messageId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
  text: z.string().min(1).max(MAX_MESSAGE_CHARS).optional(),
  model: z.enum(MODEL_IDS),
  thinking: z.object({ harder: z.boolean() }).default({ harder: false }),
  scenario: z.enum(SCENARIO_NAMES).optional(),
  /** D10/#21: Edit and Regenerate name the first message to drop; the engine replaces in one transaction. */
  replaceFromMessageId: z.string().uuid().optional(),
});

/** D2: idempotent on `generationId`; a duplicate POST attaches to the existing generation. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request", issues: parsed.error.issues });
    const body = parsed.data;
    if (isDraining()) return jsonError(503, { error: "draining" }, { "retry-after": "5" });
    const { engine, store, rateLimiter } = getRelay();
    const limit = rateLimiter.check(user.id, false);
    if (!limit.ok) {
      const seconds = Math.ceil(limit.retryAfterMs / 1000);
      return jsonError(429, { error: "rate_limited", retryAfterMs: limit.retryAfterMs }, { "retry-after": String(seconds) });
    }
    // One client cannot hold the process with parallel generations (#62); a duplicate POST for a running id still attaches.
    if (!engine.owner(body.generationId) && engine.runningFor(user.id) >= MAX_RUNNING_PER_USER) {
      return jsonError(429, { error: "rate_limited", retryAfterMs: 2000 }, { "retry-after": "2" });
    }
    const scenario = body.scenario ? SCENARIOS[body.scenario] : undefined;
    if (body.replaceFromMessageId) {
      // Settle the replaced turns' generations first: deleting a running one's rows would strand its buffer.
      const db = getDb();
      const from = db
        .select({ position: schema.messages.position })
        .from(schema.messages)
        .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
        .where(and(eq(schema.messages.id, body.replaceFromMessageId), eq(schema.messages.chatId, body.chatId), eq(schema.chats.userId, user.id)))
        .get();
      if (from) {
        const victims = db
          .select({ generationId: schema.messages.generationId })
          .from(schema.messages)
          .where(and(eq(schema.messages.chatId, body.chatId), gte(schema.messages.position, from.position)))
          .all();
        await Promise.all(victims.map((v) => (v.generationId ? engine.stopAndWait(v.generationId) : Promise.resolve())));
      }
    }
    let created = false;
    try {
      const outcome = engine.start({
        generationId: body.generationId,
        chatId: body.chatId,
        userId: user.id,
        userRole: user.role,
        userMessageId: body.messageId,
        assistantMessageId: body.assistantMessageId,
        text: body.text,
        model: body.model,
        thinking: body.thinking,
        scenario: body.scenario,
        replaceFromMessageId: body.replaceFromMessageId,
        faults: scenario?.interruptAfterEvents ? { interruptAfterEvents: scenario.interruptAfterEvents } : undefined,
      });
      created = outcome.created;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return jsonError(402, { error: "quota_exceeded", spentUsd: err.spentUsd, capUsd: err.capUsd });
      }
      if (err instanceof ForbiddenError) return jsonError(403, { error: "forbidden" });
      if (err instanceof DrainingError) return jsonError(503, { error: "draining" }, { "retry-after": "5" });
      if (err instanceof Error && /retry without/.test(err.message)) return jsonError(409, { error: "missing_user_message" });
      throw err;
    }
    if (created) rateLimiter.check(user.id, true);
    // A duplicate POST attaches to an existing generation only for its owner.
    if (!created && engine.owner(body.generationId) !== user.id) return jsonError(403, { error: "forbidden" });
    if (!store.has(body.generationId)) {
      // Duplicate POST after the buffer was evicted: serve the saved state.
      const outcome = engine.resume(body.generationId, user.id);
      if (outcome.kind === "snapshot") return singleEventResponse(outcome.event, request.headers.get("accept-encoding"));
      return jsonError(404, { error: "not_found" });
    }
    return streamGeneration(store, body.generationId, -1, {
      dropAfterEvents: scenario?.dropAfterEvents,
      stallAfterEvents: scenario?.stallAfterEvents,
      signal: request.signal,
      acceptEncoding: request.headers.get("accept-encoding"),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
