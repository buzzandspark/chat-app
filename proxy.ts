import { NextResponse, type NextRequest } from "next/server";
import { uuidv7 } from "@shared/id";
import { crossSite } from "@server/cross-site";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];
// ADR-0004: cookie-presence redirect only; real validation is `getCurrentUser`.
// Development and the e2e harness run against the seeded dev user without a cookie.
export function proxy(request: NextRequest) {
  // better-auth checks the origin of its own endpoints against its trusted origins.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!request.nextUrl.pathname.startsWith("/api/auth/") && crossSite(request.method, request.headers)) {
      return NextResponse.json({ error: "cross_site" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.next();
  }
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  const bypass = process.env.NODE_ENV !== "production" || process.env.E2E === "1";
  if (!hasCookie && !bypass) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  // `/c/new` is an alias, not a page: a new chat is an id with no rows yet, chosen by the client, so
  // no "new" view is ever mounted and kept alive by the router (ADR-0005). In-app affordances
  // navigate straight to `/c/<uuid>`; this covers bookmarks and external links.
  if (request.nextUrl.pathname === "/c/new") {
    const url = request.nextUrl.clone();
    url.pathname = `/c/${uuidv7()}`;
    return NextResponse.redirect(url, 307);
  }
  // ADR-0004: validation happens in the layout; it needs the path to send an expired session back here.
  const headers = new Headers(request.headers);
  headers.set("x-cadence-path", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/c/:path*", "/settings", "/api/:path*"],
};
