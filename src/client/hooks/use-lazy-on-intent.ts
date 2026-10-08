"use client";
import { useCallback, useRef, useState } from "react";

/**
 * D21: a Radix-backed control's chunk loads on the first sign of intent, not at mount. Hover, touch
 * and focus only warm the chunk: swapping the element on any event that precedes a click (mousedown
 * focuses the button) would lose the click. A press arms the real control and asks it to open; a
 * keyboard press is a click too, and Radix returns focus to the real trigger when it closes (a
 * control that goes back to its stand-in carries that focus over, see `closed`). The chunks stay
 * behind `next/dynamic`, which keeps them out of the route's client-reference manifest (a raw
 * `import()` target is listed there and counted by the size gate).
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
  // Back to the stand-in once the control has closed, so an armed row stops carrying its Radix tree (#44).
  // Not on `onOpenChange(false)`: that unmounted the real trigger in the same commit, so Radix's close
  // auto-focus (a timeout later) found no trigger and focus fell to <body>. `closed` is the content's
  // `onCloseAutoFocus`; it runs before Radix's own handler, which focuses `trigger` unless the menu was
  // closed by an interaction elsewhere (in a modal menu, a right-click), so the outcome is read a microtask later. If the trigger has focus
  // then, the stand-in that replaces it takes it (`standIn`); if it doesn't, focus is left alone.
  // Callback refs, not ref objects: the intent is passed to helpers during render (`intentProps`).
  const triggerEl = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const trigger = useCallback((el: HTMLButtonElement | null) => {
    triggerEl.current = el;
  }, []);
  const closed = useCallback(() => {
    queueMicrotask(() => {
      refocus.current = triggerEl.current !== null && document.activeElement === triggerEl.current;
      setArmed(false);
      setWanted(null);
    });
  }, []);
  const standIn = useCallback((el: HTMLButtonElement | null) => {
    if (!el || !refocus.current) return;
    refocus.current = false;
    el.focus();
  }, []);
  return { armed, wanted, warmUp, press, trigger, closed, standIn };
}

/** Event props for a stand-in button: warm the chunk on hover, touch and focus; never swap before a click. */
export function intentProps(i: { warmUp: () => void }) {
  return { onPointerEnter: i.warmUp, onTouchStart: i.warmUp, onFocus: i.warmUp };
}
