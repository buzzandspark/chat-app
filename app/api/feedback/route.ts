import type { NextRequest } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";
import { errorResponse, getCurrentUser, jsonError } from "@server/current-user";

const Body = z.object({
  body: z.string().trim().min(1).max(4000),
  chatId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
  timings: z.record(z.string(), z.unknown()).optional(),
});

/** D25: in-app feedback with the chat id and the latency breakdown of the reply in view. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await getCurrentUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    getDb()
      .insert(schema.feedback)
      .values({
        id: uuidv7(),
        userId: user?.id ?? null,
        chatId: parsed.data.chatId ?? null,
        messageId: parsed.data.messageId ?? null,
        body: parsed.data.body,
        timings: (parsed.data.timings as schema.Message["timings"]) ?? null,
        userAgent: request.headers.get("user-agent"),
        createdAt: new Date(),
      })
      .run();
    return Response.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
