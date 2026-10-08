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

/** Server snapshot is `false`: the phone layout is the base (D0). */
export function useMediaQuery(query: string): boolean {
  return useMatches(query, false);
}

const DOCK_QUERY = "(min-width: 768px) and (min-height: 480px)";

/** Matches the `dock` CSS variant: wide and tall enough to dock the sidebar (a landscape phone is not, #31). */
export function useIsDesktop(): boolean {
  return useMediaQuery(DOCK_QUERY);
}

/**
 * useIsDesktop, but null where the viewport is unknown: on the server and in the hydration render. For
 * what must not guess, like the sidebar's inert, which on a desktop would lock the docked list away
 * from the keyboard until hydration if the phone base were assumed.
 */
export function useIsDesktopOrNull(): boolean | null {
  return useMatches(DOCK_QUERY, null);
}

export function useHasHover(): boolean {
  return useMediaQuery("(hover: hover)");
}
