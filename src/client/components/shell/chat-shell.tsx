"use client";
import { Menu, MessageSquareText, PanelLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";
import type { ChatSummary } from "@client/store/sidebar-store";
import { useSidebarChats } from "@client/store/sidebar-store";
import { useChat } from "@client/store/hooks";
import { ChatStoreProvider } from "@client/store/context";
import { ModalProvider, useModals } from "../ui/modal-manager";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useVisualViewport } from "@client/hooks/use-visual-viewport";
import dynamic from "next/dynamic";
import { Sidebar } from "./sidebar";

const SearchDialog = dynamic(() => import("./search-dialog").then((m) => m.SearchDialog), { ssr: false });
const FeedbackDialog = dynamic(() => import("./feedback-dialog").then((m) => m.FeedbackDialog), { ssr: false });
const RenameDialog = dynamic(() => import("./chat-dialogs").then((m) => m.RenameDialog), { ssr: false });

interface ChatShellProps {
  initialChats: ChatSummary[];
  userLabel: string;
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

function ChatShellInner({ initialChats, userLabel, children }: ChatShellProps) {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const chats = useSidebarChats();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const { show } = useModals();
  const newChat = useNewChat();
  const searchCloser = useRef<(() => void) | null>(null);
  useVisualViewport();

  const open = desktop ? desktopOpen : phoneOpen;
  const close = useCallback(() => (desktop ? setDesktopOpen(false) : setPhoneOpen(false)), [desktop]);
  const toggle = useCallback(() => (desktop ? setDesktopOpen((v) => !v) : setPhoneOpen((v) => !v)), [desktop]);

  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  const openChat = useChat(currentChatId ?? "");
  const currentSummary = currentChatId ? chats.find((c) => c.id === currentChatId) : undefined;
  // An id the server knows nothing about is a new chat; until the rows have arrived the title stays blank.
  const title = currentChatId
    ? (currentSummary?.title ?? openChat.title ?? (openChat.seeded && openChat.messageIds.length === 0 ? "New chat" : ""))
    : "";

  const openSearch = useCallback(() => {
    searchCloser.current?.();
    searchCloser.current = show(({ open, close }) => <SearchDialog open={open} onOpenChange={(o) => !o && close()} />);
  }, [show]);
  const openFeedback = useCallback(
    () => show(({ open, close }) => <FeedbackDialog open={open} onOpenChange={(o) => !o && close()} chatId={currentChatId} />),
    [show, currentChatId],
  );
  const openRename = useCallback(() => {
    if (!currentChatId) return;
    const chat = currentSummary ?? { id: currentChatId, title, updatedAt: 0 };
    show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />);
  }, [show, currentChatId, currentSummary, title]);

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
        setPhoneOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, phoneOpen, newChat, openSearch]);

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
      <Sidebar
        initialChats={initialChats}
        open={open}
        onClose={close}
        onNavigate={() => setPhoneOpen(false)}
        onSearch={openSearch}
        userLabel={userLabel}
      />
      {/* min-h-0: a long thread must scroll inside the column, never push the composer below the fold. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="safe-top flex h-[calc(3.5rem+env(safe-area-inset-top,0px))] shrink-0 items-center gap-1 border-b border-border px-2 md:px-3">
          <IconButton label={open ? "Hide sidebar" : "Show sidebar"} tipAlign="start" aria-expanded={open} onClick={toggle}>
            {desktop ? <PanelLeft /> : <Menu />}
          </IconButton>
          {currentChatId && currentSummary ? (
            <Button
              variant="ghost"
              size="sm"
              className="tip min-w-0 flex-1 justify-start truncate px-2 text-small font-medium"
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
          <IconButton label="Send feedback" tipAlign="end" onClick={openFeedback}>
            <MessageSquareText />
          </IconButton>
        </header>
        {children}
      </div>

    </div>
  );
}
