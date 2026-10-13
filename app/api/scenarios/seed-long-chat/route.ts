import type { SeedLongChatResponse } from "@shared/api";
import { GUEST_MODEL } from "@shared/models";
import { assertMayInteract, errorResponse, jsonError, requireUser, scenariosAllowed } from "@server/current-user";
import { seedLongChat } from "@server/long-chat";
import { getLimiters, tooMany } from "@server/ratelimit";

export async function POST(): Promise<Response> {
  try {
    const user = await requireUser();
    if (!scenariosAllowed(user.role)) return jsonError(403, { error: "forbidden" });
    assertMayInteract(user);
    const limit = getLimiters().seedLongChat.check(user.id);
    if (!limit.ok) return tooMany(limit.retryAfterMs);
    // The chat opens on its last reply's model: a guest's must be one it can use.
    const seeded = seedLongChat(user.id, user.role === "guest" ? GUEST_MODEL : "claude-sonnet-5-5");
    return Response.json(seeded satisfies SeedLongChatResponse, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
