"use client";

// Its own chunk, fetched while the fork sheet is open, so the reveal plays from the strip's first frame.

/** The Explore button widens into the tab strip, then each tab grows into its slot. */
export const EXPAND_MS = 280;
export const TAB_MS = 240;
export const STAGGER_MS = 60;
/** The sheet's exit (`ResponsiveDialog`: duration-250, md:duration-150), which the reveal waits out. */
const SHEET_CLOSE_MS = { phone: 250, md: 150 };
/** A reveal no strip has picked up by then is dropped, so a later strip doesn't play it. */
const PICKUP_MS = 2000;

interface Reveal {
  parentId: string;
  from: DOMRect;
  /** Held at its first frame this long, standing in for the button while the sheet closes. */
  delay: number;
  createdAt: number;
  startedAt: number | null;
}

let reveal: Reveal | null = null;

/** Called as the forks are listed and the sheet closes, with the button's box; the strip that appears next starts from it. */
export function startTabReveal(parentId: string, from: DOMRect): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const delay = window.matchMedia("(min-width: 768px)").matches ? SHEET_CLOSE_MS.md : SHEET_CLOSE_MS.phone;
  reveal = { parentId, from, delay, createdAt: performance.now(), startedAt: null };
}

function pendingReveal(parentId: string): Reveal | null {
  if (!reveal || reveal.parentId !== parentId) return null;
  if (reveal.startedAt === null && performance.now() - reveal.createdAt > PICKUP_MS) reveal = null;
  return reveal;
}

function endReveal(r: Reveal): void {
  if (reveal === r) reveal = null;
}

export function revealDuration(tabs: number): number {
  return EXPAND_MS + TAB_MS + STAGGER_MS * Math.max(0, tabs - 1);
}

/**
 * Plays the pending reveal, if any, on a strip of `parentId`'s tabs. A strip that appears midway (the fork's own view,
 * after the navigation) continues from the same moment, so the two views read as one animation.
 */
export function playTabReveal(parentId: string, strip: HTMLElement, morph: HTMLElement): void {
  const r = pendingReveal(parentId);
  if (!r) return;
  const now = performance.now();
  r.startedAt ??= now + r.delay;
  const tabs = Array.from(strip.querySelectorAll<HTMLElement>("[data-tab-slot]"));
  const total = revealDuration(tabs.length);
  const elapsed = now - r.startedAt;
  if (elapsed >= total) {
    endReveal(r);
    return;
  }
  // The morph is positioned against the strip's wrapper, whose box is the strip's.
  const box = strip.getBoundingClientRect();
  const expanded = EXPAND_MS / total;
  const expand = morph.animate(
    [
      { offset: 0, top: `${r.from.top - box.top}px`, left: `${r.from.left - box.left}px`, width: `${r.from.width}px`, height: `${r.from.height}px`, borderRadius: "8px", opacity: 1, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      { offset: expanded, top: "0px", left: "0px", width: `${box.width}px`, height: `${box.height}px`, borderRadius: "8px", opacity: 1 },
      { offset: Math.min(1, expanded + TAB_MS / total), top: "0px", left: "0px", width: `${box.width}px`, height: `${box.height}px`, borderRadius: "8px", opacity: 0 },
    ],
    { duration: total, fill: "backwards" },
  );
  const animations = [
    expand,
    ...tabs.map((tab, i) =>
      tab.animate([{ transform: "scaleX(0)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1 }], {
        duration: TAB_MS,
        delay: EXPAND_MS + i * STAGGER_MS,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        fill: "backwards",
      }),
    ),
  ];
  for (const a of animations) a.currentTime = elapsed;
  void expand.finished.then(
    () => endReveal(r),
    () => {},
  );
}
