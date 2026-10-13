import type { NextRequest } from "next/server";
import { errorResponse, requireUser } from "@server/current-user";
import { refuseSearch } from "@server/ratelimit";
import { searchChats } from "@server/search";
import type { SearchResponse } from "@shared/api";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (q.length < 2) return Response.json({ hits: [] } satisfies SearchResponse, { headers: { "cache-control": "no-store" } });
    const refused = refuseSearch(request, user);
    if (refused) return refused;
    return Response.json({ hits: searchChats(user.id, q) } satisfies SearchResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
