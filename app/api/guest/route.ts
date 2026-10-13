import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@auth/server";
import { getDb, schema } from "@db/client";
import { guestsBlocked } from "@server/instance-settings";
import { clientKeys, getLimiters } from "@server/ratelimit";
import { isDraining } from "@server/shutdown";
import { safeNext } from "@shared/safe-next";

// A relative Location: the browser stays on the host it used, so the cookie set here goes with it
// (request.url can name another host than the one in the address bar, e.g. localhost for 127.0.0.1).
function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path, "cache-control": "no-store" } });
}

/** A top-level page load: not an <img>, a fetch, an unfurler or a monitor (none send both). */
function isPageVisit(h: Headers): boolean {
  return h.get("sec-fetch-mode") === "navigate" && h.get("sec-fetch-dest") === "document";
}

/**
 * A visitor without a session becomes a guest here (the proxy sends them), then goes back where they were.
 * Only a page visit creates one; any other GET writes nothing.
 */
export async function GET(request: Request): Promise<Response> {
  return start(request, isPageVisit(request.headers));
}

/** The login page's "Continue as a guest": a form on this site (proxy.ts refuses a cross-site POST). */
export async function POST(request: Request): Promise<Response> {
  return start(request, true);
}

/** A live session is reused; new guests are limited per address and overall, and past that or while guests are blocked it is sign-in only. */
async function start(request: Request, mayCreate: boolean): Promise<Response> {
  const next = safeNext(new URL(request.url).searchParams.get("next")) ?? "/c";
  const back = redirectTo(next);
  const auth = getAuth();
  const reqHeaders = await headers();
  const existing = await auth.api.getSession({ headers: reqHeaders }).catch(() => null);
  const current = existing?.user as { banned?: boolean | null } | undefined;
  if (current && !current.banned) return back;
  // The browser discards a refused prefetch or prerender, so the visit itself comes back here and makes the guest.
  if (request.headers.has("sec-purpose")) return new Response(null, { status: 503, headers: { "cache-control": "no-store" } });
  const login = `/login?next=${encodeURIComponent(next)}`;
  if (!mayCreate) return redirectTo(login);
  const unavailable = `${login}&guest=unavailable`;
  const { guestStart, guestStartAll } = getLimiters();
  const keys = clientKeys(request);
  if (isDraining() || guestsBlocked() || !guestStart.check(keys.ip, false).ok || !guestStartAll.check("all", false).ok) return redirectTo(unavailable);
  // Counted only when both allow it, and before the sign-in's await, so a burst of visits cannot all pass the check.
  guestStart.check(keys.ip);
  guestStartAll.check("all");
  // A stale cookie (an expired or purged session) must not block a fresh guest.
  const fresh = new Headers(reqHeaders);
  fresh.delete("cookie");
  const result = await auth.api.signInAnonymous({ headers: fresh, returnHeaders: true }).catch(() => null);
  const user = result?.response?.user;
  if (!result || !user) return redirectTo(unavailable);
  getDb().update(schema.users).set({ lastActiveAt: new Date(), budgetKeys: keys.budgetKeys }).where(eq(schema.users.id, user.id)).run();
  result.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") back.headers.append("set-cookie", value);
  });
  return back;
}
