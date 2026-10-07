"use client";
import { useSyncExternalStore, type ComponentType } from "react";

// A failed `import()` is remembered by React.lazy (and by the browser's module map) for the life of
// the lazy object, so a retry needs a fresh one. Every lazy control is created through a factory
// that is re-run after a chunk failure; successful chunks are already in the browser cache, so a
// recreated wrapper resolves at once.
let generation = 0;
const listeners = new Set<() => void>();

/** Called by a chunk boundary's Retry (and when the browser comes back online): recreate every lazy wrapper. */
export function retryChunks(): void {
  generation++;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Wraps a `next/dynamic` factory so the wrapper is recreated after `retryChunks()`. The factory must
 * contain the literal `dynamic(() => import("…"))` call, which Next's compiler needs to see.
 */
export function lazyChunk<P extends object>(make: () => ComponentType<P>): ComponentType<P> {
  let cached: { gen: number; component: ComponentType<P> } | null = null;
  function LazyChunk(props: P) {
    const gen = useSyncExternalStore(subscribe, () => generation, () => 0);
    if (!cached || cached.gen !== gen) cached = { gen, component: make() };
    const Component = cached.component;
    return <Component {...props} />;
  }
  return LazyChunk;
}
