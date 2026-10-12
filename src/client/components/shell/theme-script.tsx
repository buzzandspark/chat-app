"use client";
import { useSyncExternalStore } from "react";

// Applies the stored theme, and D14's scroll-anchoring flag (WebKit reports overflow-anchor yet doesn't anchor
// content-visibility rows, so the engine is identified by vendor), before first paint. A string: no bundle, no React.
const THEME_SCRIPT =
  "(function(){try{document.documentElement.dataset.scrollAnchoring=CSS.supports('overflow-anchor: auto')&&navigator.vendor!=='Apple Computer, Inc.'?'yes':'no';var t=localStorage.getItem('chat-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);if(t){var ms=document.querySelectorAll('meta[name=\"theme-color\"]');for(var i=0;i<ms.length;i++){ms[i].removeAttribute('media');ms[i].setAttribute('content',d?'#1a1816':'#faf9f6');}}}catch(e){}})();";

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
  return <script id="chat-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
