import { getAuth } from "@auth/server";

// Only what the app's own pages call over HTTP; the server reads sessions and signs guests in through auth.api.
const ALLOWED = new Set(["/api/auth/sign-in/email", "/api/auth/sign-out"]);

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export function GET(): Response {
  return notFound();
}

export async function POST(request: Request): Promise<Response> {
  if (!ALLOWED.has(new URL(request.url).pathname)) return notFound();
  return getAuth().handler(request);
}
