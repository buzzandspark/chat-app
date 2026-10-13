"use client";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useChatStore } from "@client/store/context";
import { prefetchChat } from "@client/store/prefetch";
import { usePendingChat, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { useModals } from "@client/components/ui/modal-manager";
import { SidebarRow } from "./sidebar-row";

/** What the rows need from the sidebar around them (the list is a slot the layout streams in). */
export interface SidebarListContextValue {
  onNavigate: () => void;
}
export const SidebarListContext = createContext<SidebarListContextValue>({ onNavigate: () => {} });

/** The chat list, server-rendered from the user's rows (the layout streams it into the sidebar's slot). */
export function SidebarList({ initialChats, userId }: { initialChats: ChatSummary[]; userId: string }) {
  const chats = useSidebarChats({ chats: initialChats, userId });
  const { onNavigate } = useContext(SidebarListContext);
  const pathname = usePathname();
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  // The clicked row is active at once; the router catches up when the thread arrives.
  const pendingChatId = usePendingChat();
  const activeChatId = pendingChatId ?? currentChatId;
  const router = useRouter();
  const store = useChatStore();
  const { show } = useModals();

  // On intent (hover, focus, touchstart), and for the top five as they come into view, warm the route shell and
  // seed the chat's rows into the store so the click renders from memory (ADR-0005).
  const warm = useCallback(
    (chatId: string) => {
      router.prefetch(`/c/${chatId}`);
      void prefetchChat(store, chatId);
    },
    [router, store],
  );
  // Keyed on what remounts their rows too (pinning moves a row between lists), so new rows are observed.
  const topFive = chats
    .slice(0, 5)
    .map((c) => `${c.id}${c.pinned ? "+" : ""}`)
    .join(" ");
  const warmTopFive = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !topFive) return;
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const id = e.isIntersecting ? e.target.getAttribute("data-chat-row") : null;
          if (id) warm(id);
        }
      });
      for (const key of topFive.split(" ")) {
        const row = el.querySelector(`[data-chat-row="${key.replace("+", "")}"]`);
        if (row) io.observe(row);
      }
      return () => io.disconnect();
    },
    [topFive, warm],
  );

  if (chats.length === 0) return <p className="px-2 py-3 text-small text-muted-foreground">No chats yet.</p>;
  // Forks sit under their parent and show only while it, or one of them, is open; a fork whose parent is not listed stands alone.
  const ids = new Set(chats.map((c) => c.id));
  const forksOf = new Map<string, ChatSummary[]>();
  for (const c of chats) {
    if (!c.forkedFrom || !ids.has(c.forkedFrom)) continue;
    forksOf.set(c.forkedFrom, [...(forksOf.get(c.forkedFrom) ?? []), c]);
  }
  for (const list of forksOf.values()) list.sort((a, b) => (a.forkOrder ?? 0) - (b.forkOrder ?? 0));
  const topLevel = chats.filter((c) => !(c.forkedFrom && ids.has(c.forkedFrom)));
  const activeParent = activeChatId ? (chats.find((c) => c.id === activeChatId)?.forkedFrom ?? activeChatId) : null;
  const pinned = topLevel.filter((c) => c.pinned);
  const rest = topLevel.filter((c) => !c.pinned);
  const row = (chat: ChatSummary) => {
    const forks = forksOf.get(chat.id) ?? [];
    return (
      <SidebarRow key={chat.id} chat={chat} active={chat.id === activeChatId} forked={forks.length > 0} nested={false} currentChatId={currentChatId} onNavigate={onNavigate} warm={warm} show={show}>
        {forks.length > 0 && chat.id === activeParent ? (
          <ul className="mt-0.5 space-y-0.5 pl-4" aria-label={`Forks of ${chat.title}`}>
            {forks.map((f) => (
              <SidebarRow key={f.id} chat={f} active={f.id === activeChatId} forked={false} nested currentChatId={currentChatId} onNavigate={onNavigate} warm={warm} show={show} />
            ))}
          </ul>
        ) : null}
      </SidebarRow>
    );
  };
  const heading = (id: string, text: string) => (
    <h2 id={id} className="px-3 pb-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
      {text}
    </h2>
  );
  const sectioned = pinned.length > 0;
  return (
    <div ref={warmTopFive} className="space-y-3">
      {sectioned ? (
        <section aria-labelledby="sidebar-pinned">
          {heading("sidebar-pinned", "Pinned")}
          <ul className="space-y-0.5">{pinned.map(row)}</ul>
        </section>
      ) : null}
      {rest.length > 0 ? (
        <section aria-labelledby={sectioned ? "sidebar-chats" : undefined}>
          {sectioned ? heading("sidebar-chats", "Chats") : null}
          <ul className="space-y-0.5">{rest.map(row)}</ul>
        </section>
      ) : null}
    </div>
  );
}

/** The static shell's stand-in for the list: the same row height, no text. */
export function SidebarListSkeleton() {
  return (
    <ul className="space-y-0.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex min-h-11 items-center pl-3">
          <Skeleton className={cn("h-4", i % 2 ? "w-2/3" : "w-5/6")} />
        </li>
      ))}
    </ul>
  );
}
