import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // `SOURCEMAPS=1 pnpm build` for scripts/bundle-report.mjs (D21 attribution).
  productionBrowserSourceMaps: process.env.SOURCEMAPS === "1",
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // better-sqlite3 is a native module; load it through Node's require, not the bundler.
  serverExternalPackages: ["better-sqlite3"],
  // The invite page's URL holds a password-setting token: no request it makes (the analytics and Sentry
  // scripts, fonts, the redeem POST, the page after it) may carry it in a Referer, nor `document.referrer` on
  // the next page. A header rather than a <meta>, so it holds before the head is parsed.
  headers: () => [{ source: "/invite/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }],
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
