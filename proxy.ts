import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_ADDRESS_HEADER, forwardedAddress } from "@server/client-address";
import { crossSite } from "@server/cross-site";
import { getRun } from "@server/evals";
import { env } from "@shared/env";

// Single segments the app serves. Any other would reach [adminSlug], whose notFound() comes after the shell
// has streamed with a 200, so it 404s here instead.
const TOP_LEVEL = new Set(["c", "settings", "login", "preview", "evals", "icon", "apple-icon", "manifest.webmanifest", "favicon.ico", "robots.txt"]);
const SESSION_PATH = /^\/(c(\/|$)|settings$|$)/;

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];
// ADR-0004: cookie-presence redirect only; real validation is `getCurrentUser`.
// A visitor without a session becomes a guest (/api/guest); the e2e harness runs as the seeded dev user instead.
export function proxy(request: NextRequest) {
  // better-auth checks the origin of its own endpoints against its trusted origins.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!request.nextUrl.pathname.startsWith("/api/auth/") && crossSite(request.method, request.headers)) {
      return NextResponse.json({ error: "cross_site" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    const headers = new Headers(request.headers);
    headers.delete(CLIENT_ADDRESS_HEADER);
    const address = forwardedAddress(request.headers);
    if (address !== null) headers.set(CLIENT_ADDRESS_HEADER, address);
    return NextResponse.next({ request: { headers } });
  }
  const segment = /^\/([^/]+)$/.exec(request.nextUrl.pathname)?.[1];
  if (segment !== undefined && !TOP_LEVEL.has(segment) && segment !== env.ADMIN_PATH_SLUG) {
    return NextResponse.rewrite(new URL("/_not-found", request.url));
  }
  const run = /^\/evals\/([^/]+)$/.exec(request.nextUrl.pathname)?.[1];
  if (run !== undefined && !getRun(run)) return NextResponse.rewrite(new URL("/_not-found", request.url));
  if (!SESSION_PATH.test(request.nextUrl.pathname)) return NextResponse.next();
  // No landing page: the root opens a new chat, in one hop for a new visitor rather than through /c.
  const root = request.nextUrl.pathname === "/";
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasCookie && process.env.E2E !== "1") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/guest";
    url.search = "";
    url.searchParams.set("next", (root ? "/c" : request.nextUrl.pathname) + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // `/c/new` bookmarks and links go to /c, where a new chat lives until its first send.
  if (root || request.nextUrl.pathname === "/c/new") {
    const url = request.nextUrl.clone();
    url.pathname = "/c";
    return NextResponse.redirect(url, 307);
  }
  // ADR-0004: validation happens in the layout; it needs the path to send an expired session back here.
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/", "/((?!_)[^/]+)", "/c/:path*", "/evals/:id", "/api/:path*"],
};
