"use client";
import { useEffect } from "react";

/** D25: the minimal Sentry client loads in idle time after first paint, outside the route bundle. */
export function Monitoring({ dsn }: { dsn: string | null }) {
  useEffect(() => {
    if (!dsn) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void import("@client/monitoring/sentry").then(({ startSentry }) => {
        if (cancelled) return;
        startSentry(dsn);
      });
    };
    const hasIdle = "requestIdleCallback" in window;
    const handle = hasIdle ? window.requestIdleCallback(start) : window.setTimeout(start, 2000);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [dsn]);
  return null;
}
