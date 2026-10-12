"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ChunkBoundary } from "./chunk-boundary";

export interface ModalApi {
  open: boolean;
  close: () => void;
}
export type ModalRender = (api: ModalApi) => ReactNode;

interface Entry {
  id: number;
  open: boolean;
  render: ModalRender;
}

interface ModalManager {
  /** Mounts a modal; returns its closer. Stays mounted through the exit animation. */
  show: (render: ModalRender) => () => void;
  closeAll: () => void;
  openCount: number;
}

const ModalContext = createContext<ModalManager | null>(null);
const EXIT_MS = 300;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const seq = useRef(0);

  const close = useCallback((id: number) => {
    setEntries((es) => es.map((e) => (e.id === id && e.open ? { ...e, open: false } : e)));
    setTimeout(() => setEntries((es) => es.filter((e) => e.id !== id)), EXIT_MS);
  }, []);

  const show = useCallback(
    (render: ModalRender) => {
      const id = ++seq.current;
      setEntries((es) => [...es, { id, open: true, render }]);
      return () => close(id);
    },
    [close],
  );

  const closeAll = useCallback(() => {
    setEntries((es) => es.map((e) => ({ ...e, open: false })));
    setTimeout(() => setEntries([]), EXIT_MS);
  }, []);

  const openCount = entries.filter((e) => e.open).length;
  const value = useMemo(() => ({ show, closeAll, openCount }), [show, closeAll, openCount]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {entries.map((e) => (
        <ChunkBoundary
          key={e.id}
          label="dialog"
          fallback={null}
          // The dialog cannot show itself; close its entry.
          onError={() => close(e.id)}
        >
          {e.render({ open: e.open, close: () => close(e.id) })}
        </ChunkBoundary>
      ))}
    </ModalContext.Provider>
  );
}

export function useModals(): ModalManager {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModals outside ModalProvider");
  return ctx;
}
