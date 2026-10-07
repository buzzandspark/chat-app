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

/** Matches the `dock` CSS variant: wide and tall enough to dock the sidebar (a landscape phone is not, #31). */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px) and (min-height: 480px)");
}

export function useHasHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
