"use client";
import { Menu, MessageSquareText, PanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";
import { setPendingChat, usePendingChat, useSidebarChats } from "@client/store/sidebar-store";
import { useChat } from "@client/store/hooks";
import { ChatStoreProvider, useChatStore } from "@client/store/context";
import { ModalProvider, useModals } from "../ui/modal-manager";
import { lazyChunk } from "../ui/lazy-chunk";
import { markNavigationClose, useBackGesture } from "@client/hooks/use-back-gesture";
import { useIsDesktopOrNull } from "@client/hooks/use-media-query";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useScrollAnchoringFlag } from "@client/hooks/use-scroll-anchoring";
import { useVisualViewport } from "@client/hooks/use-visual-viewport";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";

const SearchDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.SearchDialog), { ssr: false }));
const FeedbackDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.FeedbackDialog), { ssr: false }));
const RenameDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.RenameDialog), { ssr: false }));

interface ChatShellProps {
  /** The chat list and the user label are server slots: the chrome around them is static (#20). */
  sidebarList: ReactNode;
  userLabel: ReactNode;
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

function ChatShellInner({ sidebarList, userLabel, children }: ChatShellProps) {
  // Null until the viewport is known (server, hydration render); everything but the sidebar's
  // modality treats that as the phone base, as useIsDesktop does.
  const desktopOrNull = useIsDesktopOrNull();
  const desktop = desktopOrNull === true;
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const { show } = useModals();
  const newChat = useNewChat();
  const searchCloser = useRef<(() => void) | null>(null);
  useVisualViewport();
  useScrollAnchoringFlag();

  const open = desktop ? desktopOpen : phoneOpen;
  // The phone modal dismissed (X, backdrop, Escape, the back gesture) hands focus back to the menu button
  // that opened it, once the column is no longer inert. Closed by a navigation or by Search it is left
  // where the route or the dialog puts it, so those paths call setPhoneOpen directly.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const dismissPhone = useCallback(() => {
    returnFocus.current = true;
    setPhoneOpen(false);
  }, []);
  useEffect(() => {
    // Reset on open too: a dismiss while already closed would otherwise leave the flag for a later navigation.
    if (!phoneOpen && returnFocus.current) menuButtonRef.current?.focus();
    returnFocus.current = false;
  }, [phoneOpen]);
  useBackGesture(!desktop && phoneOpen, dismissPhone);
  const close = useCallback(() => (desktop ? setDesktopOpen(false) : dismissPhone()), [desktop, dismissPhone]);
  const toggle = useCallback(() => (desktop ? setDesktopOpen((v) => !v) : setPhoneOpen((v) => !v)), [desktop]);
  const closePhone = useCallback(() => setPhoneOpen(false), []);
  const onSidebarNavigate = useCallback(() => {
    markNavigationClose();
    setPhoneOpen(false);
  }, []);

  const openSearch = useCallback(() => {
    // Search from the phone sidebar replaces it: the picked chat must not open underneath the overlay (#33).
    if (!desktop) setPhoneOpen(false);
    searchCloser.current?.();
    searchCloser.current = show(({ open, close }) => <SearchDialog open={open} onOpenChange={(o) => !o && close()} />);
  }, [show, desktop]);

  // D19 shortcuts: ⌘/Ctrl+Shift+O new chat, ⌘/Ctrl+K search, Esc closes the phone sidebar first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isModifier(e) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      } else if (isModifier(e) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "Escape" && !desktop && phoneOpen) {
        dismissPhone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, phoneOpen, newChat, openSearch, dismissPhone]);

  // Inset swipe-to-open: starts at least 24 px in from the left edge (D0).
  useEffect(() => {
    if (desktop) return;
    let startX = 0;
    let startY = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // A horizontally scrollable code block or table owns its own swipes (#75).
      const scrollable = (e.target as Element | null)?.closest?.(".markdown-code-pre, .overflow-x-auto");
      tracking = !scrollable && t.clientX >= 24 && t.clientX <= 56 && !phoneOpen;
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
      />
      {/* min-h-0: a long thread must scroll inside the column, never push the composer below the fold.
          While the phone sidebar is open the column is inert, so the sidebar is a real modal (#56). */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" inert={!desktop && phoneOpen ? true : undefined}>
        <header data-tip-boundary className="safe-top flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border pl-[max(0.5rem,env(safe-area-inset-left,0px))] pr-[max(0.5rem,env(safe-area-inset-right,0px))] md:pl-[max(0.75rem,env(safe-area-inset-left,0px))] md:pr-[max(0.75rem,env(safe-area-inset-right,0px))]">
          <IconButton ref={menuButtonRef} label={open ? "Hide sidebar" : "Show sidebar"} aria-expanded={open} onClick={toggle}>
            {desktop ? <PanelLeft /> : <Menu />}
          </IconButton>
          {/* #20: the chrome is in the static shell; only what depends on the URL streams in here. */}
          <Suspense fallback={<HeaderRouteFallback />}>
            <HeaderRoute onPathnameChange={closePhone} />
          </Suspense>
        </header>
        {children}
      </div>

    </div>
  );
}

function HeaderRouteFallback() {
  return (
    <>
      <h1 className="min-w-0 flex-1 truncate px-2 text-small font-medium" data-testid="chat-title" />
      <IconButton label="Send feedback" disabled>
        <MessageSquareText />
      </IconButton>
    </>
  );
}

/**
 * Everything in the shell that depends on the URL: the title, rename, feedback for this chat, the
 * release of the pending chat, the store's eviction of chats visited long ago, and putting the phone
 * sidebar away on navigation. It suspends during prerender, so the chrome around it stays static (#20).
 */
function HeaderRoute({ onPathnameChange }: { onPathnameChange: () => void }) {
  const pathname = usePathname();
  const chats = useSidebarChats();
  const store = useChatStore();
  const { show } = useModals();
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  const pendingChatId = usePendingChat();
  // The pending chat is released once the router has committed it (or left the chat routes).
  useEffect(() => {
    if (pendingChatId !== null && (pendingChatId === currentChatId || currentChatId === null)) setPendingChat(null);
  }, [pendingChatId, currentChatId]);
  // Any navigation puts the phone sidebar away, whatever started it (#34).
  useEffect(() => {
    onPathnameChange();
  }, [pathname, onPathnameChange]);
  const openChat = useChat(currentChatId ?? "");
  // #72: of the chats that were opened, the store keeps the current one and the eight before it; older
  // ones give their rows back. Chats only prefetched for the sidebar are small and stay.
  const visitedRef = useRef<string[]>([]);
  useEffect(() => {
    if (!currentChatId) return;
    const visited = visitedRef.current.filter((id) => id !== currentChatId);
    visited.push(currentChatId);
    visitedRef.current = visited;
    const stale = visited.slice(0, -9).filter((id) => id !== pendingChatId);
    if (stale.length > 0) store.evictChats(stale);
  }, [currentChatId, pendingChatId, store]);
  const currentSummary = currentChatId ? chats.find((c) => c.id === currentChatId) : undefined;
  const pendingSummary = pendingChatId ? chats.find((c) => c.id === pendingChatId) : undefined;
  // D21: the header switches to the clicked chat's title on click. An id the server knows nothing
  // about is a new chat; until its rows have arrived the title stays blank.
  const title =
    pendingSummary?.title ??
    (currentChatId
      ? (currentSummary?.title ?? openChat.title ?? (openChat.seeded && openChat.messageIds.length === 0 ? "New chat" : ""))
      : "");
  const openFeedback = useCallback(
    () => show(({ open, close }) => <FeedbackDialog open={open} onOpenChange={(o) => !o && close()} chatId={currentChatId} />),
    [show, currentChatId],
  );
  const openRename = useCallback(() => {
    if (!currentChatId) return;
    const chat = currentSummary ?? { id: currentChatId, title, updatedAt: 0 };
    show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />);
  }, [show, currentChatId, currentSummary, title]);
  return (
    <>
      {currentChatId && currentSummary ? (
        <Button
          variant="ghost"
          size="sm"
          className="tip min-h-11 min-w-0 flex-1 justify-start truncate px-2 text-small font-medium"
          aria-label={`Rename chat: ${title}`}
          data-tip="Rename"
          data-tip-side="bottom"
          onClick={openRename}
        >
          <h1 className="truncate" data-testid="chat-title">
            {title}
          </h1>
        </Button>
      ) : (
        <h1 className="min-w-0 flex-1 truncate px-2 text-small font-medium" data-testid="chat-title">
          {title}
        </h1>
      )}
      <IconButton label="Send feedback" onClick={openFeedback}>
        <MessageSquareText />
      </IconButton>
    </>
  );
}
