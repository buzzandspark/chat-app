"use client";
import { useSyncExternalStore, type ComponentType } from "react";

type MarkdownComponent = (typeof import("./Markdown"))["Markdown"];

// #83: the Markdown renderer is its own chunk. A saved chat's rows are not shown until it has arrived,
// and once it has, rows render the loaded component directly: a `React.lazy` wrapper suspends on its
// first render even when the module is already in, which commits the fallback first and the reply a
// task later, and that second commit moved everything below the reply (the cold-load CLS test caught
// a 154 px shift). The fetch starts as soon as this module evaluates, before hydration on a cold load.
let component: MarkdownComponent | null = null;
let pending: Promise<unknown> | null = null;
const listeners = new Set<() => void>();

export function ensureMarkdown(): Promise<unknown> {
  if (!pending) {
    pending = import("./Markdown").then((m) => {
      component = m.Markdown;
      for (const l of listeners) l();
    });
    pending.catch(() => {
      pending = null;
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

if (typeof window !== "undefined") void ensureMarkdown();
