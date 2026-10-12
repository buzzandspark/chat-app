import { NextResponse, type NextRequest } from "next/server";
import { crossSite } from "@server/cross-site";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];
// ADR-0004: cookie-presence redirect only; real validation is `getCurrentUser`.
// A visitor without a session becomes a guest (/api/guest); the e2e harness runs as the seeded dev user instead.
export function proxy(request: NextRequest) {
  // better-auth checks the origin of its own endpoints against its trusted origins.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    if (!request.nextUrl.pathname.startsWith("/api/auth/") && crossSite(request.method, request.headers)) {
      return NextResponse.json({ error: "cross_site" }, { status: 403, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.next();
  }
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasCookie && process.env.E2E !== "1") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/guest";
    url.search = "";
    url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // `/c/new` from old bookmarks and links goes to /c, where a new chat lives until its first send.
  if (request.nextUrl.pathname === "/c/new") {
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
  matcher: ["/c/:path*", "/settings", "/api/:path*"],
};
