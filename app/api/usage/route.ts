import { capUsage } from "@server/settings";
import { errorResponse, requireUser } from "@server/current-user";
import type { CapUsage } from "@shared/api";

/** The header's usage bar: what the cap has counted so far, and the cap. */
export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    return Response.json(capUsage(user.id) satisfies CapUsage, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
