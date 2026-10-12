import { tokenize, type HighlightLine } from "./highlight-core";

/** Loaded on the first highlight, not with the route. */
type Waiter = { resolve: (lines: HighlightLine[]) => void; reject: (err: Error) => void };
let worker: Worker | null = null;
let workerUnavailable = false;
let nextId = 0;
const waiters = new Map<number, Waiter>();

function getWorker(): Worker | null {
  if (workerUnavailable || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./highlight.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerUnavailable = true;
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; lines?: HighlightLine[]; error?: string }>) => {
    const w = waiters.get(event.data.id);
    if (!w) return;
    waiters.delete(event.data.id);
    if (event.data.lines) w.resolve(event.data.lines);
    else w.reject(new Error(event.data.error ?? "highlight failed"));
  };
  worker.onerror = () => {
    // The chunk did not load or the worker crashed: fall back to the main thread for good.
    workerUnavailable = true;
    worker = null;
    for (const w of waiters.values()) w.reject(new Error("highlight worker failed"));
    waiters.clear();
  };
  return worker;
}

function viaWorker(w: Worker, code: string, lang: string): Promise<HighlightLine[]> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    waiters.set(id, { resolve, reject });
    w.postMessage({ id, code, lang });
  });
}

export async function tokenizeAnywhere(code: string, lang: string): Promise<{ lines: HighlightLine[]; source: "worker" | "thread" }> {
  const w = getWorker();
  if (w) {
    try {
      return { lines: await viaWorker(w, code, lang), source: "worker" };
    } catch (err) {
      if (!workerUnavailable) throw err;
    }
  }
  return { lines: await tokenize(code, lang), source: "thread" };
}
