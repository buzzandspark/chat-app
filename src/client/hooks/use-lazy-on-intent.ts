"use client";
import { useCallback, useRef, useState } from "react";

/**
 * Hover, touch and focus only warm the chunk: swapping the element before a click would lose the click.
 * `failed` is for the control to throw inside its ChunkBoundary.
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
  // Not on `onOpenChange(false)`: unmounting the trigger then sends Radix's close auto-focus to <body>.
  // `closed` is `onCloseAutoFocus`, which runs before Radix focuses the trigger, so focus is read a microtask later.
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
