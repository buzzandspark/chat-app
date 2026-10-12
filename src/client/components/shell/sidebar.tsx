"use client";
import { PanelLeft, Plus, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { buttonVariants } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";
import { cn } from "@/lib/utils";
import { useNewChat } from "@client/hooks/use-new-chat";
import { sidebarAria } from "./sidebar-aria";
import { SidebarListContext } from "./sidebar-list";
import { SignOutButton } from "./sign-out-button";
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
  /** The header's toggle, which the shell focuses when the main header's toggle opens the dock. */
  toggleRef: RefObject<HTMLButtonElement | null>;
}

/** D0: overlay on phones, docked at md. Hover reveal of ⋯ keys off (hover: hover), not width. */
export function Sidebar({ list, desktop, phoneOpen, desktopOpen, open, onClose, onNavigate, onSearch, userLabel, toggleRef }: SidebarProps) {
  const newChat = useNewChat();
  const listContext = useMemo(() => ({ open, onNavigate }), [open, onNavigate]);
  const asideRef = useRef<HTMLElement>(null);
  const modal = desktop === false && phoneOpen;
  // Opening the phone modal makes the column behind it inert, which would drop focus on <body>: it moves
  // onto the dialog instead (announced by its name, no tooltip popping on the first button), and the
  // next Tab reaches Search. The shell puts it back on the menu button when the modal is dismissed.
  useEffect(() => {
    if (modal) asideRef.current?.focus({ preventScroll: true });
  }, [modal]);

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
          "dock:static dock:z-0 dock:w-72 dock:translate-x-0 dock:transition-[width,transform]",
          desktopOpen ? "dock:flex" : "dock:hidden",
        )}
      >
        {/* The toggle sits where the main header's sits (same inset, and a clear border so the same height), so opening and closing never moves it. */}
        <div className="flex h-14 items-center justify-between gap-1 border-b border-transparent pr-2 pl-2 md:pl-3">
          <div className="flex min-w-0 items-center gap-1">
            <IconButton ref={toggleRef} label={desktop ? "Hide sidebar" : "Close sidebar"} aria-expanded={open} onClick={onClose}>
              <X className="dock:hidden" />
              <PanelLeft className="hidden dock:block" />
            </IconButton>
            <span className="truncate px-1 text-small font-semibold tracking-tight">Cadence</span>
          </div>
          <div className="flex items-center">
            <IconButton label="Search chats" onClick={onSearch}>
              <Search />
            </IconButton>
            {/* href keeps open-in-new-tab working through the /c/new alias; a plain click goes straight to a fresh id. */}
            <Link
              href="/c/new"
              prefetch={false}
              aria-label="New chat"
              data-tip="New chat"
              data-tip-side="bottom"
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
            <SignOutButton />
          </div>
        </div>
      </aside>

    </>
  );
}
