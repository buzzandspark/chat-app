"use client";
import { useCallback, useRef, useState } from "react";

/**
 * D21: a Radix-backed control's chunk loads on the first sign of intent, not at mount. Hover, touch
 * and focus only warm the chunk: swapping the element on any event that precedes a click (mousedown
 * focuses the button) would lose the click. A press arms the real control and asks it to open; a
 * keyboard press is a click too, and Radix returns focus to the real trigger when it closes. The
 * chunks stay behind `next/dynamic`, which keeps them out of the route's client-reference manifest
 * (a raw `import()` target is listed there and counted by the size gate).
 */
export function useIntent(warm: () => Promise<unknown>) {
  const [armed, setArmed] = useState(false);
  const [wanted, setWanted] = useState<string | null>(null);
  const warmed = useRef(false);
  const warmUp = useCallback(() => {
    if (warmed.current) return;
    warmed.current = true;
    warm().catch(() => {
      warmed.current = false;
    });
  }, [warm]);
  const press = useCallback(
    (what: string) => {
      warmUp();
      setArmed(true);
      setWanted(what);
    },
    [warmUp],
  );
  return { armed, wanted, warmUp, press };
}

/** Event props for a stand-in button: warm the chunk on hover, touch and focus; never swap before a click. */
export function intentProps(i: { warmUp: () => void }) {
  return { onPointerEnter: i.warmUp, onTouchStart: i.warmUp, onFocus: i.warmUp };
}
