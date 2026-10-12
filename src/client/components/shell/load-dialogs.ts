"use client";
import { chunk } from "../ui/lazy-chunk";

/** #82: every dialog is in this one chunk; fetched in idle time after the page loads, so the first open waits for nothing. */
export const loadDialogs = chunk(() => import("./dialogs"));

if (typeof window !== "undefined") {
  const preload = () => void loadDialogs().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 5000 });
  else setTimeout(preload, 2000);
}
