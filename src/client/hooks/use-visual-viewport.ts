"use client";
import { useEffect } from "react";

/**
 * D19: one shared hook drives the composer and every bottom sheet with a text
 * field. It writes the keyboard's height to `--keyboard-inset` on the root
 * and marks `data-keyboard="open"` so bottom safe-area padding collapses to
 * zero while the keyboard is up. Browsers honouring
 * `interactive-widget=resizes-content` report no difference and nothing
 * changes; iOS Safari reports it through `visualViewport`.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
      root.dataset.keyboard = inset > 80 ? "open" : "closed";
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--keyboard-inset");
      delete root.dataset.keyboard;
    };
  }, []);
}
