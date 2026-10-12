"use client";
import { Plus, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { useMemo, type ReactNode, type RefObject } from "react";
import { buttonVariants } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";
import { cn } from "@/lib/utils";
import { useNewChat } from "@client/hooks/use-new-chat";
import { sidebarAria } from "./sidebar-aria";
import { SidebarListContext } from "./sidebar-list";
import { ThemeToggle } from "./theme-toggle";

interface SidebarProps {
  /** The chat list, streamed in by the layout once the session is known (#20). */
  list: ReactNode;
  /** Which mode the viewport is in: the dock or the phone overlay; null where it is not known yet (server, hydration render). */
  desktop: boolean | null;
  /** The phone overlay (below md). */
  phoneOpen: boolean;
  /** The desktop dock (md and up); true on the server so the first paint is already docked (no CLS). */
  desktopOpen: boolean;
  /** Whichever applies to the current viewport; exposed as data-open for tests. */
  open: boolean;
  onClose: () => void;
  /** Called after a link is followed; the shell closes the overlay on phones and keeps the dock on desktop. */
  onNavigate: () => void;
  onSearch: () => void;
  /** The signed-in user's label, streamed in with the list. */
  userLabel: ReactNode;
  /** Sign out for an account, Sign in for a guest: it needs the session, so the layout streams it in. */
  account: ReactNode;
  /** The aside, which the shell focuses when it opens the phone modal. */
  asideRef: RefObject<HTMLElement | null>;
}

/** D0: overlay on phones, docked at md. Hover reveal of ⋯ keys off (hover: hover), not width. */
export function Sidebar({ list, desktop, phoneOpen, desktopOpen, open, onClose, onNavigate, onSearch, userLabel, account, asideRef }: SidebarProps) {
  const newChat = useNewChat();
  const listContext = useMemo(() => ({ onNavigate }), [onNavigate]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/30 backdrop-blur-[1px] transition-opacity dock:hidden",
          phoneOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        ref={asideRef}
        data-tip-boundary
        aria-label="Chats"
        data-open={open}
        // Hidden in the current mode it is inert; the phone overlay open is the modal (#56). Keyed off the
        // mode: desktopOpen stays true on a phone, so the open flags alone cannot tell which one applies.
        {...sidebarAria(desktop, phoneOpen, desktopOpen)}
        className={cn(
          // outline-none: it is focused only programmatically, as the dialog, never by Tab.
          "fixed inset-y-0 left-0 z-40 flex w-full flex-col bg-sidebar text-sidebar-foreground outline-none",
          "border-r border-sidebar-border transition-transform duration-200 ease-out",
          // Full width on a phone, so both insets apply in landscape (#30); docked, only the left one.
          "safe-top pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] dock:pr-0",
          phoneOpen ? "translate-x-0" : "-translate-x-full",
          // Docked it slides: the width closes to 0 while the contents move left in step.
          "dock:static dock:z-0 dock:translate-x-0 dock:overflow-hidden dock:transition-[width] motion-reduce:transition-none",
          desktopOpen ? "dock:w-72" : "dock:w-0 dock:border-r-0",
        )}
      >
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col dock:w-72 dock:shrink-0 dock:transition-transform dock:duration-200 dock:ease-out motion-reduce:transition-none",
            !desktopOpen && "dock:-translate-x-full",
          )}
        >
        {/* Docked, the shell's pinned toggle sits over this header's left end; the X here closes the phone overlay. */}
        <div className="flex h-14 items-center justify-between gap-1 border-b border-transparent pr-2 pl-2 md:pl-3">
          <div className="flex min-w-0 items-center gap-1">
            <IconButton label="Close sidebar" aria-expanded={open} className="dock:invisible" onClick={onClose}>
              <X />
            </IconButton>
          </div>
          <div className="flex items-center">
            <IconButton label="Search chats" shortcut="⌘K" aria-keyshortcuts="Meta+K Control+K" onClick={onSearch}>
              <Search />
            </IconButton>
            {/* href keeps open-in-new-tab working; a plain click opens a fresh view (useNewChat). */}
            <Link
              href="/c"
              prefetch={false}
              aria-label="New chat"
              data-tip="New chat  ⌘⇧O"
              aria-keyshortcuts="Meta+Shift+O Control+Shift+O"
              data-tip-side="bottom"
              // At the sidebar's right edge: the tip opens leftward instead of spilling past it.
              data-tip-align="end"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "tip touch-target")}
              onClick={onNavigate}
              onNavigate={(e) => {
                e.preventDefault();
                newChat();
              }}
            >
              <Plus />
            </Link>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <SidebarListContext.Provider value={listContext}>{list}</SidebarListContext.Provider>
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2">
          <span className="min-h-4 truncate text-caption text-muted-foreground">{userLabel}</span>
          <div className="flex items-center">
            <Link
              href="/settings"
              prefetch={false}
              aria-label="Settings"
              data-tip="Settings"
              data-tip-side="top"
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "tip touch-target")}
              onClick={onNavigate}
            >
              <Settings />
            </Link>
            <ThemeToggle />
            {account}
          </div>
        </div>
        </div>
      </aside>

    </>
  );
}
