import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

// ADR-0004: cookie-presence redirect only; real validation is `getCurrentUser`.
// Development and the e2e harness run against the seeded dev user without a cookie.
export function proxy(request: NextRequest) {
  const hasCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasCookie) return NextResponse.next();
  const bypass = process.env.NODE_ENV !== "production" || process.env.E2E === "1";
  if (bypass) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/c/:path*"],
};
