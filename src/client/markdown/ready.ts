"use client";
import { useSyncExternalStore, type ComponentType } from "react";

type MarkdownComponent = (typeof import("./Markdown"))["Markdown"];

// #83: the Markdown renderer is its own chunk. A saved chat's rows are not shown until it has arrived,
// and once it has, rows render the loaded component directly: a `React.lazy` wrapper suspends on its
// first render even when the module is already in, which commits the fallback first and the reply a
// task later, and that second commit moved everything below the reply (the cold-load CLS test caught
// a 154 px shift). The fetch starts as soon as this module evaluates, before hydration on a cold load.
let component: MarkdownComponent | null = null;
let failed = false;
let pending: Promise<unknown> | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

export function ensureMarkdown(): Promise<unknown> {
  if (!pending) {
    pending = import("./Markdown").then((m) => {
      component = m.Markdown;
      notify();
    });
    // A failure is remembered so the thread stops waiting (rows show plain text); a send, `online`
    // or the tab being shown again fetches the chunk anew.
    pending.catch(() => {
      pending = null;
      failed = true;
      notify();
    });
  }
  return pending;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The loaded renderer, or null until its chunk is in (always null on the server). */
export function useMarkdownComponent(): ComponentType<Parameters<MarkdownComponent>[0]> | null {
  return useSyncExternalStore(subscribe, () => component, () => null);
}

/** True once the renderer's chunk is in; false on the server. */
export function useMarkdownReady(): boolean {
  return useMarkdownComponent() !== null;
}

/** True once a fetch of the chunk has failed, and from then on; false on the server. */
export function useMarkdownFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed, () => false);
}

if (typeof window !== "undefined") {
  void ensureMarkdown();
  // As ChunkBoundary does: the usual reason a chunk failed is the network.
  const retry = () => {
    if (!component) void ensureMarkdown();
  };
  window.addEventListener("online", retry);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retry();
  });
}
