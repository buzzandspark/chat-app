"use client";

/**
 * A chunk loaded on demand, then rendered directly. A lazy component (next/dynamic, React.lazy) suspends
 * on its first mount even when its code is in, and React holds a boundary's content back for 300 ms after
 * its fallback shows: that was the ~310 ms before every modal and menu first opened, and the blank where a
 * ⋯ stood. Load first, then render what loaded: no Suspense, so no wait. A failed load is forgotten, so the
 * next attempt fetches the chunk again instead of replaying the failure.
 */
export function chunk<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    }));
}
