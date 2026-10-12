import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@auth/server";
import { getDb, schema } from "@db/client";
import { clientIp, getLimiters } from "@server/ratelimit";
import { isDraining } from "@server/shutdown";
import { safeNext } from "@shared/safe-next";

// A relative Location: the browser stays on the host it used, so the cookie set here goes with it
// (request.url can name another host than the one in the address bar, e.g. localhost for 127.0.0.1).
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
}

/**
 * A visitor without a session becomes a guest here (the proxy sends them), then goes back where they were.
 * A live session is reused; new guests are limited per address, and past the limit it is sign-in only.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next")) ?? "/c";
  const back = redirectTo(next);
  const auth = getAuth();
  const reqHeaders = await headers();
  const existing = await auth.api.getSession({ headers: reqHeaders }).catch(() => null);
  const current = existing?.user as { banned?: boolean | null } | undefined;
  if (current && !current.banned) return back;
  const login = `/login?next=${encodeURIComponent(next)}`;
  const limiters = getLimiters();
  if (isDraining() || !limiters.guestStart.check(clientIp(request)).ok || !limiters.guestStartAll.check("all").ok) return redirectTo(login);
  // A stale cookie (an expired or purged session) must not block a fresh guest.
  const fresh = new Headers(reqHeaders);
  fresh.delete("cookie");
  const result = await auth.api.signInAnonymous({ headers: fresh, returnHeaders: true }).catch(() => null);
  const user = result?.response?.user;
  if (!result || !user) return redirectTo(login);
  getDb().update(schema.users).set({ lastActiveAt: new Date() }).where(eq(schema.users.id, user.id)).run();
  result.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") back.headers.append("set-cookie", value);
  });
  return back;
}
