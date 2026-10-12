"use client";
import { useSyncExternalStore } from "react";

// Applies the stored theme and the scroll-anchoring flag before first paint (WebKit reports overflow-anchor yet
// doesn't anchor content-visibility rows, so the engine is identified by vendor). A string: no bundle, no React.
const THEME_SCRIPT =
  "(function(){try{document.documentElement.dataset.scrollAnchoring=CSS.supports('overflow-anchor: auto')&&navigator.vendor!=='Apple Computer, Inc.'?'yes':'no';var t=localStorage.getItem('chat-theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);if(t){var ms=document.querySelectorAll('meta[name=\"theme-color\"]');for(var i=0;i<ms.length;i++){ms[i].removeAttribute('media');ms[i].setAttribute('content',d?'#1a1816':'#faf9f6');}}}catch(e){}})();";

const subscribeNoop = () => () => {};

/**
 * Inline in <head>, ahead of every Next script, so dark mode applies before first paint (beforeInteractive is too late).
 * Server HTML only: the next render removes it, and a client-render fallback never creates a script React would warn about.
 */
export function ThemeScript() {
  const serverRender = useSyncExternalStore(subscribeNoop, () => false, () => true);
  if (!serverRender) return null;
  return <script id="chat-theme" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
