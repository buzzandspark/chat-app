// D21: 180 KB gzipped JS budget on the chat route. Turbopack (Next 16) writes
// per-route manifests under .next/server/app/<route>/: the runtime chunks in
// page/build-manifest.json and the client component chunks in
// page_client-reference-manifest.js. Lazy imports (shiki, per-language
// grammars) are separate chunks and are not in either, as intended.
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
    limit: "190 kB",
    gzip: true,
  },
];
