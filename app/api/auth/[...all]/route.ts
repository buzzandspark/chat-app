import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@auth/server";

const handler = toNextJsHandler((request: Request) => getAuth().handler(request));

// A guest is created only through /api/guest (rate limited per address), never over this endpoint.
const BLOCKED = new Set(["/api/auth/sign-in/anonymous"]);

export const GET = handler.GET;
export async function POST(request: Request): Promise<Response> {
  if (BLOCKED.has(new URL(request.url).pathname)) return Response.json({ error: "not_found" }, { status: 404 });
  return handler.POST(request);
}
