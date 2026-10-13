"use client";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { chunk } from "@client/components/ui/lazy-chunk";
import { useChatStore } from "@client/store/context";
import { useChat } from "@client/store/hooks";
import { setPendingChat, usePendingChat, useSidebarChats } from "@client/store/sidebar-store";
import type { TitleInput as TitleInputComponent } from "./title-input";

// The inline rename loads on intent (hover, focus, touch on the title); the title stays until it has.
const loadTitleInput = chunk(() => import("./title-input").then((m) => m.TitleInput));

export function HeaderRouteFallback() {
  return <h1 className="min-w-0 flex-1 truncate px-2 text-small font-medium" data-testid="chat-title" />;
}

/** Everything in the shell that depends on the URL; it suspends during prerender so the chrome around it stays static. */
export function HeaderRoute({ onPathnameChange }: { onPathnameChange: () => void }) {
  const pathname = usePathname();
  const chats = useSidebarChats();
  const store = useChatStore();
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  const pendingChatId = usePendingChat();
  const openChat = useChat(currentChatId ?? "");
  // The store keeps the current chat and the eight opened before it; older ones give their rows back.
  // Chats only prefetched for the sidebar are small and stay.
  const visitedRef = useRef<string[]>([]);
  // Each committed navigation puts the phone sidebar away, whatever started it, and releases the pending chat.
  // Mounting is not a navigation: this boundary can hydrate after the sidebar was already opened.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      onPathnameChange();
    }
    setPendingChat(null);
    if (!currentChatId) return;
    const visited = visitedRef.current.filter((id) => id !== currentChatId);
    visited.push(currentChatId);
    // A chat still streaming when it ages out stays listed, so a later navigation evicts it once the reply ends.
    visitedRef.current = [...store.evictChats(visited.slice(0, -9)), ...visited.slice(-9)];
  }, [pathname, currentChatId, onPathnameChange, store]);
  const currentSummary = currentChatId ? chats.find((c) => c.id === currentChatId) : undefined;
  const pendingSummary = pendingChatId ? chats.find((c) => c.id === pendingChatId) : undefined;
  // The header switches to the clicked chat's title on click. An id the server doesn't know is a new chat,
  // whose title stays blank until its rows arrive.
  const title =
    pendingSummary?.title ??
    (currentChatId
      ? (currentSummary?.title ?? openChat.title ?? (openChat.seeded && openChat.messageIds.length === 0 ? "New chat" : ""))
      : pathname === "/c"
        ? "New chat"
        : pathname === "/settings"
          ? "Settings"
          : "");
  // Clicking the title turns it into an input in place; another chat ends the edit, including one whose
  // input was still loading when the chat changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [editsFor, setEditsFor] = useState(currentChatId);
  if (currentChatId !== editsFor) {
    setEditsFor(currentChatId);
    setEditingId(null);
  }
  const [TitleInput, setTitleInput] = useState<typeof TitleInputComponent | null>(null);
  const warmTitle = () => {
    loadTitleInput().catch(() => {});
  };
  return (
    <>
      {currentChatId && currentSummary && editingId === currentChatId && TitleInput ? (
        <TitleInput chatId={currentChatId} title={title} onClose={() => setEditingId(null)} onFailed={() => setFailedId(currentChatId)} />
      ) : currentChatId && currentSummary ? (
        <Button
          variant="ghost"
          size="sm"
          className="tip min-h-11 min-w-0 flex-1 justify-start truncate px-2 text-small font-medium"
          aria-label={`Rename chat: ${title}`}
          data-tip="Rename"
          data-tip-side="bottom"
          onPointerEnter={warmTitle}
          onTouchStart={warmTitle}
          onFocus={warmTitle}
          onClick={() => {
            loadTitleInput().then(
              (input) => {
                setTitleInput(() => input);
                setFailedId(null);
                setEditingId(currentChatId);
              },
              () => {},
            );
          }}
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
      {failedId !== null && failedId === currentChatId ? (
        <span role="alert" className="shrink-0 px-2 text-caption text-destructive">
          Couldn&apos;t rename the chat.
        </span>
      ) : null}
    </>
  );
}
