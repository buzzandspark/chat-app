import type { NextConfig } from "next";

// On every response. No script-src yet: Next's inline bootstrap scripts would need per-request nonces,
// which would end the static prerender of the shell; these directives don't touch scripts.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

// API responses are for this site's pages only: other origins can't embed them, and crawlers skip them.
const API_HEADERS = [
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // `SOURCEMAPS=1 pnpm build` for scripts/bundle-report.mjs (D21 attribution).
  productionBrowserSourceMaps: process.env.SOURCEMAPS === "1",
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // better-sqlite3 is a native module; load it through Node's require, not the bundler.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // A restored dev cache lacks HMR's asset registry, so pages reloaded every second (HMR `restart`); compile fresh.
    turbopackFileSystemCacheForDev: false,
  },
  // The invite page's URL holds a password-setting token: no request it makes (the analytics and Sentry
  // scripts, fonts, the redeem POST, the page after it) may carry it in a Referer, nor `document.referrer` on
  // the next page. A header rather than a <meta>, so it holds before the head is parsed.
  // Last match wins for a repeated key, so the invite rule comes after the site-wide one.
  headers: () => [
    { source: "/:path*", headers: SECURITY_HEADERS },
    { source: "/api/:path*", headers: API_HEADERS },
    { source: "/invite/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
