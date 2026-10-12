"use client";
import { useEffect, useEffectEvent } from "react";

const KEY = "chatSheet";
const NAVIGATION_WINDOW_MS = 1000;
let navigationCloseAt = -Infinity;

/**
 * Call right before closing a sheet because a navigation follows: going back ourselves would race the router's
 * pending push. The cleanup runs whenever React flushes it, so the mark is a time window.
 */
export function markNavigationClose(): void {
  navigationCloseAt = performance.now();
}

// One listener for all sheets: a pop closes only the sheet opened last, and a pop we caused ourselves
// (a sheet closed from its own UI drops its entry) closes nothing.
const stack: Array<{ close: () => void }> = [];
let suppressedPops = 0;
let listening = false;
function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    if (suppressedPops > 0) {
      suppressedPops--;
      return;
    }
    if (stack.length > 0) {
      stack.pop()?.close();
      return;
    }
    // Back landed on an entry a sheet left behind when a navigation closed it: nothing to close, skip it.
    if ((window.history.state as { [KEY]?: boolean } | null)?.[KEY]) window.history.back();
  });
}

/**
 * Back closes a covering sheet instead of leaving the chat. Next's patched pushState copies its router state,
 * so going back lands on the same route. `open` is true only while the sheet covers the page.
 */
export function useBackGesture(open: boolean, onClose: () => void): void {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    listen();
    let popped = false;
    const entry = {
      close: () => {
        popped = true;
        close();
      },
    };
    window.history.pushState({ ...(window.history.state ?? {}), [KEY]: true }, "", window.location.href);
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      if (popped) return;
      const navigating = performance.now() - navigationCloseAt < NAVIGATION_WINDOW_MS;
      // Closed from its own UI while still on its entry, and not because a navigation is under way: drop the entry.
      if (!navigating && (window.history.state as { [KEY]?: boolean } | null)?.[KEY]) {
        suppressedPops++;
        window.history.back();
      }
    };
  }, [open]);
}
