import { hashString } from "./blocks";
import type { HighlightLine } from "./highlight-core";

export type { HighlightLine } from "./highlight-core";
export { resolveLanguage } from "./languages";

/**
 * D15: highlighted lines by content hash, tokenised in a Web Worker when the browser has one and
 * in-thread otherwise (tests, very old browsers, a worker that failed to load). A block seen once,
 * in this chat or another, never tokenises again, so reopening a chat is a cache hit. The worker
 * handle, shiki and the fallback live in `highlight-runtime`, loaded on the first highlight: a raw
 * `new Worker` or `import()` target in a route module is listed in its client-reference manifest
 * and counted by the size gate, a chunk behind a lazy module is not.
 */
const cache = new Map<string, HighlightLine[]>();
const pending = new Map<string, Promise<HighlightLine[]>>();
const MAX_CACHED = 200;
let lastSource: "worker" | "thread" | "cache" = "thread";

/** Where the most recent tokens came from; the perf spec records it. */
export function highlightSource(): string {
  return lastSource;
}

function keyFor(code: string, lang: string): string {
  return `${lang}:${code.length}:${hashString(code)}`;
}

export function highlight(code: string, lang: string): Promise<HighlightLine[]> {
  const key = keyFor(code, lang);
  const hit = cache.get(key);
  if (hit) {
    lastSource = "cache";
    return Promise.resolve(hit);
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const run = async (): Promise<HighlightLine[]> => {
    const runtime = await import("./highlight-runtime");
    const { lines, source } = await runtime.tokenizeAnywhere(code, lang);
    lastSource = source;
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(key, lines);
    return lines;
  };
  const p = run().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
