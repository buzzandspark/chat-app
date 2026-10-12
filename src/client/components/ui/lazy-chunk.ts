"use client";

/**
 * Load first, then render directly: a lazy component suspends on first mount even with its code in, and React holds a
 * boundary's content back 300 ms after its fallback. A failed load is forgotten so the next attempt refetches.
 */
export function chunk<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    }));
}
