"use client";
import { useCallback, useRef, useState } from "react";

/**
 * D21: a Radix-backed control's chunk loads on the first sign of intent, not at mount. Hover, touch
 * and focus only warm the chunk: swapping the element on any event that precedes a click (mousedown
 * focuses the button) would lose the click. A press loads the chunk, then arms the real control (the
 * loaded component, `loaded`) and asks it to open; until then the stand-in stays, so nothing blinks. A
 * keyboard press is a click too, and Radix returns focus to the real trigger when it closes (a control
 * that goes back to its stand-in carries that focus over, see `closed`). A chunk that fails to load comes
 * back as `failed`, for the control to throw inside its ChunkBoundary, which shows a Retry in its place.
 */
export function useIntent<T>(load: () => Promise<T>) {
  const [loaded, setLoaded] = useState<{ value: T } | null>(null);
  const [armed, setArmed] = useState(false);
  const [wanted, setWanted] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  const warmUp = useCallback(() => {
    load().catch(() => {});
  }, [load]);
  const press = useCallback(
    (what: string) => {
      setFailed(null);
      load().then(
        (value) => {
          setLoaded({ value });
          setArmed(true);
          setWanted(what);
        },
        (error: unknown) => setFailed({ error }),
      );
    },
    [load],
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
  // For a ChunkBoundary's Retry when the hook lives outside the boundary (a sidebar row), so the remounted control doesn't rethrow.
  const reset = useCallback(() => setFailed(null), []);
  return { armed: armed && loaded !== null, loaded: loaded?.value ?? null, failed, reset, wanted, warmUp, press, trigger, closed, standIn };
}

/** Event props for a stand-in button: warm the chunk on hover, touch and focus; never swap before a click. */
export function intentProps(i: { warmUp: () => void }) {
  return { onPointerEnter: i.warmUp, onTouchStart: i.warmUp, onFocus: i.warmUp };
}
