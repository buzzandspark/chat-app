import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { updateUserSettings } from "@server/settings";

const Patch = z.object({ exploreOptions: z.boolean() });

/** The settings page's Explore options switch. */
export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const parsed = Patch.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    if (!updateUserSettings(user.id, parsed.data)) return jsonError(404, { error: "not_found" });
    return Response.json(parsed.data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
