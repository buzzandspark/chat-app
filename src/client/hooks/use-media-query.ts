"use client";
import { useSyncExternalStore } from "react";

/** Server snapshot is `false`: the phone layout is the base (D0). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}

export function useHasHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
