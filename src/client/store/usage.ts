"use client";
import { useSyncExternalStore } from "react";

export interface CapUsage {
  spentUsd: number;
  capUsd: number | null;
}

// The spend counter as the client last read it; `seq` orders it against the server-rendered figures.
let snapshot: { seq: number; usage: CapUsage | null } = { seq: 0, usage: null };
const listeners = new Set<() => void>();

/** A reply's cost is settled by the time its end reaches the page: read the counter again then. */
export function refreshUsage(): void {
  fetch("/api/usage")
    .then((res) => (res.ok ? (res.json() as Promise<CapUsage>) : null))
    .then((usage) => {
      if (!usage) return;
      snapshot = { seq: snapshot.seq + 1, usage };
      for (const l of listeners) l();
    })
    .catch(() => {});
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER = { seq: 0, usage: null };

export function useLiveUsage(): { seq: number; usage: CapUsage | null } {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER);
}
