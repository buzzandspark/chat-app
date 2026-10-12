import type { NextRequest } from "next/server";
import { ForbiddenError } from "@relay/engine";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { getRelay } from "@server/relay";
import { singleEventResponse, streamGeneration } from "@server/sse-response";

// The single resume path. `after` is the last producer seq the client applied (-1 for none);
// no buffer means a snapshot, no row means 404 and the client re-POSTs with the same ids.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/generations/[id]/events">): Promise<Response> {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const afterRaw = request.nextUrl.searchParams.get("after");
    const after = afterRaw === null ? -1 : Number.parseInt(afterRaw, 10);
    if (!Number.isFinite(after)) return jsonError(400, { error: "bad_after" });
    const { engine, store } = getRelay();
    let outcome;
    try {
      outcome = engine.resume(id, user.id);
    } catch (err) {
      if (err instanceof ForbiddenError) return jsonError(403, { error: "forbidden" });
      throw err;
    }
    switch (outcome.kind) {
      case "live":
        return streamGeneration(store, id, after, { signal: request.signal, acceptEncoding: request.headers.get("accept-encoding") });
      case "snapshot":
        return singleEventResponse(outcome.event, request.headers.get("accept-encoding"));
      case "not_found":
        return jsonError(404, { error: "not_found" });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
