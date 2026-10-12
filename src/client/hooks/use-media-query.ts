"use client";
import { useSyncExternalStore } from "react";

function useMatches<S>(query: string, serverSnapshot: S): boolean | S {
  return useSyncExternalStore<boolean | S>(
    (cb) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => serverSnapshot,
  );
}

/** Server snapshot is `false`: the phone layout is the base. */
export function useMediaQuery(query: string): boolean {
  return useMatches(query, false);
}

const DOCK_QUERY = "(min-width: 768px) and (min-height: 480px)";

/** Matches the `dock` CSS variant: wide and tall enough to dock the sidebar (a landscape phone is not). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DOCK_QUERY);
}

/** Null on the server and in hydration, for what must not guess (e.g. the sidebar's inert on desktop). */
export function useIsDesktopOrNull(): boolean | null {
  return useMatches(DOCK_QUERY, null);
}

export function useHasHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
