"use client";
import { useSyncExternalStore } from "react";

const tickers = new Map<number, { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> | null }>();

function subscribeTicker(intervalMs: number, cb: () => void): () => void {
  let t = tickers.get(intervalMs);
  if (!t) {
    t = { listeners: new Set(), timer: null };
    tickers.set(intervalMs, t);
  }
  t.listeners.add(cb);
  if (t.timer === null) {
    t.timer = setInterval(() => {
      for (const l of t!.listeners) l();
    }, intervalMs);
  }
  return () => {
    t!.listeners.delete(cb);
    if (t!.listeners.size === 0 && t!.timer !== null) {
      clearInterval(t!.timer);
      t!.timer = null;
    }
  };
}

/** A clock that re-renders at most every `intervalMs`, shared across subscribers. */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (cb) => subscribeTicker(intervalMs, cb),
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
