"use client";
import { useEffect } from "react";

/**
 * D14: rows may skip layout with `content-visibility: auto` only where the browser keeps what is on
 * screen still while content above it changes size. `@supports (overflow-anchor: auto)` is not
 * enough, and neither is a synthetic anchoring probe: WebKit passes both, yet does not anchor when
 * `content-visibility` rows above the viewport take their real size (measured here: a 300 px scroll
 * moved the content by 479 to 683 px, which is the iPhone Safari jump the review reported). That
 * case cannot be reproduced offscreen (the skipping margin keeps a small probe rendered), so the
 * engine is identified instead: every WebKit browser on Apple platforms reports Apple as the vendor.
 */
export function detectScrollAnchoring(): boolean {
  if (typeof document === "undefined") return false;
  if (!CSS.supports("overflow-anchor: auto")) return false;
  return navigator.vendor !== "Apple Computer, Inc.";
}

export function useScrollAnchoringFlag(): void {
  useEffect(() => {
    document.documentElement.dataset.scrollAnchoring = detectScrollAnchoring() ? "yes" : "no";
  }, []);
}
