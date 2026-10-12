import { hashString } from "./blocks";
import type { HighlightLine } from "./highlight-core";

export type { HighlightLine } from "./highlight-core";
export { resolveLanguage } from "./languages";

/**
 * Cached by content hash, tokenised in a worker when available. The runtime sits behind a lazy module because a
 * raw `new Worker`/`import()` in a route module lands in its client-reference manifest and the size gate.
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
