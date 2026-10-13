"use client";
import { Menu, PanelLeft } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { IconButton } from "@client/components/ui/icon-button";
import { ChatStoreProvider } from "@client/store/context";
import { ModalProvider, useModals } from "@client/components/ui/modal-manager";
import { loadDialogs } from "../load-dialogs";
import { markNavigationClose, useBackGesture } from "@client/hooks/use-back-gesture";
import { useIsDesktopOrNull } from "@client/hooks/use-media-query";
import { useNewChat } from "@client/hooks/use-new-chat";
import { typeToFocus } from "./type-to-focus";
import { Sidebar } from "../sidebar";
import { HeaderRoute, HeaderRouteFallback } from "./header-route";

interface ChatShellProps {
  /** Server slots, so the chrome around them stays static. */
  sidebarList: ReactNode;
  userLabel: ReactNode;
  account: ReactNode;
  /** Spend against the cap, drawn on the header's bottom border (needs the session, so a streamed slot). */
  usage: ReactNode;
  children: ReactNode;
}

function isModifier(e: KeyboardEvent): boolean {
  return navigator.platform.includes("Mac") ? e.metaKey : e.ctrlKey;
}

export function ChatShell(props: ChatShellProps) {
  return (
    <ChatStoreProvider>
      <ModalProvider>
        <ChatShellInner {...props} />
      </ModalProvider>
    </ChatStoreProvider>
  );
}

function ChatShellInner({ sidebarList, userLabel, account, usage, children }: ChatShellProps) {
  // Null until the viewport is known (server, hydration render); everything but the sidebar's
  // modality treats that as the phone base, as useIsDesktop does.
  const desktopOrNull = useIsDesktopOrNull();
  const desktop = desktopOrNull === true;
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const { show, openCount } = useModals();
  const newChat = useNewChat();
  const searchCloser = useRef<(() => void) | null>(null);

  const open = desktop ? desktopOpen : phoneOpen;
  // Focus moves in the open/close handlers (flushSync). The phone modal inerts the column, so focus goes to the dialog;
  // a dismissal returns it to the menu button, while navigation and Search call setPhoneOpen directly to leave it alone.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const openPhone = useCallback(() => {
    flushSync(() => setPhoneOpen(true));
    asideRef.current?.focus({ preventScroll: true });
  }, []);
  const dismissPhone = useCallback(() => {
    flushSync(() => setPhoneOpen(false));
    menuButtonRef.current?.focus();
  }, []);
  useBackGesture(!desktop && phoneOpen, dismissPhone);
  const toggleDesktop = useCallback(() => setDesktopOpen((o) => !o), []);
  const close = useCallback(() => (desktop ? toggleDesktop() : dismissPhone()), [desktop, toggleDesktop, dismissPhone]);
  const toggle = useCallback(() => (desktop ? toggleDesktop() : phoneOpen ? dismissPhone() : openPhone()), [desktop, phoneOpen, toggleDesktop, dismissPhone, openPhone]);
  const closePhone = useCallback(() => setPhoneOpen(false), []);
  const onSidebarNavigate = useCallback(() => {
    markNavigationClose();
    setPhoneOpen(false);
  }, []);

  const openSearch = useCallback(() => {
    // Search from the phone sidebar replaces it so the picked chat doesn't open under the overlay; the now-inert
    // Search button means a dismissed search returns focus to the menu button.
    const fromPhoneSidebar = !desktop && phoneOpen;
    // The sheet takes over the sidebar's history entry (it opens a moment later, once its chunk loads),
    // so Back closes the sheet without leaving the chat.
    if (fromPhoneSidebar) markNavigationClose();
    if (!desktop) setPhoneOpen(false);
    loadDialogs().then(({ SearchDialog }) => {
      searchCloser.current?.();
      searchCloser.current = show(({ open, close }) => (
        <SearchDialog open={open} onOpenChange={(o) => !o && close()} returnFocus={fromPhoneSidebar ? menuButtonRef : undefined} />
      ));
    }, () => {});
  }, [show, desktop, phoneOpen]);

  // Esc closes the phone sidebar first; any other character typed with nothing focused goes to the composer,
  // unless a dialog is up or the phone sidebar covers the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isModifier(e) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      } else if (isModifier(e) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "Escape" && !e.defaultPrevented && !desktop && phoneOpen) {
        dismissPhone();
      } else if (openCount === 0 && (desktop || !phoneOpen)) {
        typeToFocus(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, phoneOpen, openCount, newChat, openSearch, dismissPhone]);

  // Inset swipe-to-open: starts at least 24 px in from the left edge.
  const swipe = useRef({ x: 0, y: 0, tracking: false });
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (desktop || !t) return;
    // A horizontally scrollable code block or table owns its own swipes.
    const scrollable = (e.target as Element | null)?.closest?.(".markdown-code-pre, .overflow-x-auto");
    swipe.current = { x: t.clientX, y: t.clientY, tracking: !scrollable && t.clientX >= 24 && t.clientX <= 56 && !phoneOpen };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!swipe.current.tracking || !t) return;
    const dx = t.clientX - swipe.current.x;
    const dy = Math.abs(t.clientY - swipe.current.y);
    if (dx > 48 && dy < 40) {
      swipe.current.tracking = false;
      openPhone();
    } else if (dy > 40) swipe.current.tracking = false;
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
      <Sidebar
        list={sidebarList}
        desktop={desktopOrNull}
        phoneOpen={phoneOpen}
        desktopOpen={desktopOpen}
        open={open}
        onClose={close}
        onNavigate={onSidebarNavigate}
        onSearch={openSearch}
        userLabel={userLabel}
        account={account}
        asideRef={asideRef}
      />
      {/* Docked, the sidebar slides in and out beneath this pinned toggle and the title makes room for it. */}
      <div
        inert={!desktop && phoneOpen ? true : undefined}
        className="safe-top absolute top-0 left-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] items-center border-b border-transparent pl-[max(0.5rem,env(safe-area-inset-left,0px))] md:pl-[max(0.75rem,env(safe-area-inset-left,0px))] dock:z-50"
      >
        <IconButton ref={menuButtonRef} label={desktop && desktopOpen ? "Close sidebar" : "Open sidebar"} aria-expanded={open} onClick={toggle}>
          <Menu className="dock:hidden" />
          <PanelLeft className="hidden dock:block" />
        </IconButton>
      </div>
      {/* min-h-0 keeps a long thread scrolling inside the column; inert while the phone sidebar is open so it acts as a modal. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" inert={!desktop && phoneOpen ? true : undefined}>
        <header
          data-tip-boundary
          className={cn(
            "safe-top relative flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border transition-[padding] duration-200 ease-out motion-reduce:transition-none",
            "pr-[max(0.5rem,env(safe-area-inset-right,0px))] md:pr-[max(0.75rem,env(safe-area-inset-right,0px))]",
            // Clear of the pinned toggle, unless the open dock already holds it.
            "pl-[calc(max(0.5rem,env(safe-area-inset-left,0px))+var(--spacing-touch)+0.25rem)] md:pl-[calc(max(0.75rem,env(safe-area-inset-left,0px))+var(--spacing-touch)+0.25rem)]",
            desktopOpen && "dock:pl-3!",
          )}
        >
          {/* Only what depends on the URL streams in here; the chrome stays in the static shell. */}
          <Suspense fallback={<HeaderRouteFallback />}>
            <HeaderRoute onPathnameChange={closePhone} />
          </Suspense>
          {usage}
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>

    </div>
  );
}
