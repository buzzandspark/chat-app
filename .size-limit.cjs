// D21: 180 KB gzipped JS budget on the chat route. Paths come from the app
// build manifest so the budget tracks exactly what the chat page loads.
const fs = require("node:fs");
const path = require("node:path");

const manifestPath = path.join(__dirname, ".next", "app-build-manifest.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error("Run `pnpm build` before `pnpm size`.");
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const route = "/(chat)/c/[id]/page";
const files = (manifest.pages[route] ?? [])
  .filter((f) => f.endsWith(".js"))
  .map((f) => path.join(".next", f));
if (files.length === 0) {
  throw new Error(`No JS files found for route ${route} in app-build-manifest.json`);
}

module.exports = [
  {
    name: "chat route JS (gzip)",
    path: files,
    limit: "180 kB",
    gzip: true,
  },
];
