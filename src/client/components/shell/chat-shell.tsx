"use client";
import { Menu, PanelLeft } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ChatSummary } from "@client/store/sidebar-store";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { useVisualViewport } from "@client/hooks/use-visual-viewport";
import { Sidebar } from "./sidebar";

interface ChatShellProps {
  initialChats: ChatSummary[];
  userLabel: string;
  children: ReactNode;
}

export function ChatShell({ initialChats, userLabel, children }: ChatShellProps) {
  const desktop = useIsDesktop();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  useVisualViewport();

  const open = desktop ? desktopOpen : phoneOpen;
  const close = useCallback(() => (desktop ? setDesktopOpen(false) : setPhoneOpen(false)), [desktop]);
  const toggle = useCallback(() => (desktop ? setDesktopOpen((v) => !v) : setPhoneOpen((v) => !v)), [desktop]);

  // D19: Esc closes an open overlay first.
  useEffect(() => {
    if (desktop || !phoneOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhoneOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, phoneOpen]);

  // Inset swipe-to-open: starts at least 24 px in from the left edge (D0).
  useEffect(() => {
    if (desktop) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      tracking = t.clientX >= 24 && t.clientX <= 56 && !phoneOpen;
      startX = t.clientX;
      startY = t.clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 48 && dy < 40) {
        tracking = false;
        setPhoneOpen(true);
      } else if (dy > 40) tracking = false;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
    };
  }, [desktop, phoneOpen]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar initialChats={initialChats} open={open} onClose={close} userLabel={userLabel} />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="safe-top flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border px-2 md:px-3">
          <Button
            variant="ghost"
            size="icon"
            className="touch-target"
            aria-label={open ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={open}
            onClick={toggle}
          >
            {desktop ? <PanelLeft /> : <Menu />}
          </Button>
          <div id="chat-header-slot" className="flex min-w-0 flex-1 items-center gap-2" />
        </header>
        {children}
      </div>
    </div>
  );
}
