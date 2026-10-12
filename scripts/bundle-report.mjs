// Attributes the chat route's gzipped JS by source, from `SOURCEMAPS=1 pnpm build` maps.
// Bytes per source are generated chars between mapping segments, scaled by each chunk's gzip ratio.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require(path.resolve(".size-limit.cjs"));
const chunks = config[0].path;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeVlq(str, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    const digit = B64.indexOf(str[pos++]);
    result += (digit & 31) << shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const negative = result & 1;
  result >>= 1;
  return [negative ? -result : result, pos];
}

function label(source) {
  const s = source.replace(/^(webpack|turbopack):\/\/\/?/, "").replace(/^\[project\]\//, "").replace(/^\.\//, "");
  const nm = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(s);
  if (nm) return `pkg ${nm[1]}`;
  const parts = s.split("/");
  return `app ${parts.slice(0, Math.min(3, parts.length)).join("/")}`;
}

const totals = new Map();
let grand = 0;
for (const chunk of chunks) {
  const code = fs.readFileSync(chunk, "utf8");
  // Turbopack names the map independently of the chunk; follow the comment.
  const ref = /sourceMappingURL=([^\s]+)/.exec(code.slice(-400))?.[1];
  const mapPath = ref ? path.join(path.dirname(chunk), ref) : `${chunk}.map`;
  const gz = zlib.gzipSync(code).length;
  const ratio = gz / code.length;
  grand += gz;
  if (!fs.existsSync(mapPath)) {
    const key = `unmapped ${path.basename(chunk)}`;
    totals.set(key, (totals.get(key) ?? 0) + gz);
    continue;
  }
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const lines = code.split("\n");
  const perSource = new Map();
  let src = 0;
  const groups = map.mappings.split(";");
  for (let li = 0; li < groups.length; li++) {
    const segs = groups[li] ? groups[li].split(",") : [];
    const lineLen = (lines[li] ?? "").length + 1;
    let col = 0;
    const starts = [];
    for (const seg of segs) {
      let pos = 0;
      let v;
      [v, pos] = decodeVlq(seg, pos);
      col += v;
      if (seg.length > pos) {
        [v, pos] = decodeVlq(seg, pos);
        src += v;
      }
      starts.push([col, src]);
    }
    for (let i = 0; i < starts.length; i++) {
      const [c, s] = starts[i];
      const next = i + 1 < starts.length ? starts[i + 1][0] : lineLen;
      perSource.set(s, (perSource.get(s) ?? 0) + Math.max(0, next - c));
    }
  }
  for (const [s, bytes] of perSource) {
    const key = label(map.sources[s] ?? `unknown-${s}`);
    totals.set(key, (totals.get(key) ?? 0) + bytes * ratio);
  }
}
const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
let shown = 0;
console.log(`${"gzip kB".padStart(8)}  source`);
for (const [key, bytes] of rows.slice(0, 40)) {
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)}  ${key}`);
  shown += bytes;
}
console.log(`${(shown / 1024).toFixed(1).padStart(8)}  (top 40)`);
console.log(`${(grand / 1024).toFixed(1).padStart(8)}  total measured`);
