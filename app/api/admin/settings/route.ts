import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { setGuestsBlocked } from "@server/instance-settings";

const Patch = z.object({ guestsBlocked: z.boolean() });

/** The admin page's Block guests switch. */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    await requireAdmin();
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    setGuestsBlocked(parsed.data.guestsBlocked);
    return Response.json(parsed.data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
