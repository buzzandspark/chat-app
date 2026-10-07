import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getLimiters, tooMany } from "@server/ratelimit";

const Stamps = z
  .object({
    received: z.number().optional(),
    upstreamFirstToken: z.number().optional(),
    firstRelayed: z.number().optional(),
    done: z.number().optional(),
    declinedAttempt: z.boolean().optional(),
    sent: z.number().optional(),
    firstByte: z.number().optional(),
    firstPaint: z.number().optional(),
  })
  .strict();

const Body = z.object({
  body: z.string().trim().min(1).max(4000),
  chatId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  timings: z.object({ server: Stamps.optional(), client: Stamps.optional() }).strict().optional(),
});

/** D25: feedback from signed-in users (demo visitors included), with the reply's latency breakdown. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const limit = getLimiters().feedback.check(user.id);
    if (!limit.ok) return tooMany(limit.retryAfterMs);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    getDb()
      .insert(schema.feedback)
      .values({
        id: uuidv7(),
        userId: user.id,
        chatId: parsed.data.chatId ?? null,
        messageId: parsed.data.messageId ?? null,
        body: parsed.data.body,
        timings: (parsed.data.timings as schema.Message["timings"]) ?? null,
        userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
        createdAt: new Date(),
      })
      .run();
    return Response.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
