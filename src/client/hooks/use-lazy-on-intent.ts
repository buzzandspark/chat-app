"use client";
import { useCallback, useRef, useState } from "react";

/**
 * D21: a Radix-backed control's chunk loads on the first sign of intent (hover, focus, touch, press),
 * not at mount. Until then a look-alike button stands in; once intent is seen the `next/dynamic`
 * component mounts (its `loading` is the same look-alike, inert), and a press made before the chunk
 * arrived is remembered so the real control opens as soon as it mounts. The chunks stay behind
 * `next/dynamic`, which keeps them out of the route's client-reference manifest and so out of the
 * size gate; a raw `import()` or `new Worker` target is listed there and counted.
 */
export function useIntent() {
  const [armed, setArmed] = useState(false);
  const [wanted, setWanted] = useState<string | null>(null);
  const armedRef = useRef(false);
  const start = useCallback(() => {
    if (armedRef.current) return;
    armedRef.current = true;
    setArmed(true);
  }, []);
  const press = useCallback(
    (what: string) => {
      start();
      setWanted(what);
    },
    [start],
  );
  return { armed, wanted, start, press };
}

/** Event props that count as intent for a stand-in button. */
export function intentProps(start: () => void) {
  return { onPointerEnter: start, onFocus: start, onTouchStart: start, onPointerDown: start };
}
