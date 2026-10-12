"use client";
import { useSyncExternalStore, type ComponentType } from "react";

type MarkdownComponent = (typeof import("./Markdown"))["Markdown"];

// Not React.lazy: it suspends on first render even when the module is loaded, and the second commit caused
// layout shift. Rows wait for the chunk, which starts fetching when this module evaluates.
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

/** Always null on the server. */
export function useMarkdownComponent(): ComponentType<Parameters<MarkdownComponent>[0]> | null {
  return useSyncExternalStore(subscribe, () => component, () => null);
}

export function useMarkdownReady(): boolean {
  return useMarkdownComponent() !== null;
}

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
