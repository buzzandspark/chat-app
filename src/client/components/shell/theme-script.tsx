"use client";
import { useSyncExternalStore } from "react";

// Applies the stored theme before first paint. Kept as a string so it needs no bundle and no React.
const THEME_SCRIPT =
  "(function(){try{var t=localStorage.getItem('cadence-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();";

const subscribeNoop = () => () => {};

/**
 * An inline <script> in <head>, ahead of every Next script, so dark mode is applied before the first
 * paint (next/script's beforeInteractive goes through Next's `__next_s` queue, which is too late).
 * It exists only in server HTML: the hydration render matches it, the next render removes it, and a
 * client-render fallback never creates a script element, which React would warn about.
 */
export function ThemeScript() {
  const serverRender = useSyncExternalStore(subscribeNoop, () => false, () => true);
  if (!serverRender) return null;
  return <script id="cadence-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
