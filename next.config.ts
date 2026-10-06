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
