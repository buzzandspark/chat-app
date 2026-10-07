"use client";
import { useSyncExternalStore } from "react";

// The chat the user just asked for, before the router has committed the navigation: the sidebar row
// highlights and the header title switches on click, not when the thread arrives (D21).
let pending: string | null = null;
const listeners = new Set<() => void>();

export function setPendingChat(id: string | null): void {
  if (pending === id) return;
  pending = id;
  for (const l of listeners) l();
}

export function usePendingChat(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => pending,
    () => null,
  );
}
