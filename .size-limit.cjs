// D21 budget for the chat route. Turbopack keeps per-route manifests under .next/server/app/<route>/:
// runtime chunks in page/build-manifest.json, client component chunks in page_client-reference-manifest.js.
const fs = require("node:fs");
const path = require("node:path");

const routeDir = path.join(__dirname, ".next", "server", "app", "(chat)", "c", "[id]");
const buildManifestPath = path.join(routeDir, "page", "build-manifest.json");
const clientRefsPath = path.join(routeDir, "page_client-reference-manifest.js");
if (!fs.existsSync(buildManifestPath) || !fs.existsSync(clientRefsPath)) {
  throw new Error("Run `pnpm build` before `pnpm size`.");
}
const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
// polyfillFiles are injected with `nomodule`, so modern browsers never fetch them.
const files = new Set([...(buildManifest.rootMainFiles ?? [])]);
const refs = fs.readFileSync(clientRefsPath, "utf8");
for (const m of refs.matchAll(/"(static\/chunks\/[^"]+\.js)"/g)) files.add(m[1]);
const paths = [...files].map((f) => path.join(".next", f)).filter((f) => fs.existsSync(f));
if (paths.length === 0) throw new Error("No chat route chunks found");

module.exports = [
  {
    name: "chat route JS (gzip)",
    path: paths,
    // 200 kB until 2026-10-07 with 0.7 kB of headroom; the review's required additions (error
    // boundaries, back gesture, stand-ins for lazy controls, the scroll-anchoring flag, sign out)
    // cost about 5 kB of app code, and the only cut left is replacing `marked` (14 kB), the next
    // lever named in the design doc. Raised to 205 kB, not silently: see CHANGELOG 2026-10-07.
    limit: "205 kB",
    gzip: true,
  },
];
