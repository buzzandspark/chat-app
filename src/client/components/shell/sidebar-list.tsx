"use client";
import { GitFork, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, memo, useCallback, useContext } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { useChatStore } from "@client/store/context";
import { prefetchChat } from "@client/store/prefetch";
import { getSidebarStore, patchChatOptimistic, setPendingChat, usePendingChat, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { IconButton } from "../ui/icon-button";
import { chunk } from "../ui/lazy-chunk";
import { loadDialogs } from "./load-dialogs";
import { hideRowTip, showRowTip } from "./row-tip";
import { useModals, type ModalApi } from "../ui/modal-manager";
import type { ChatItemMenu as ChatItemMenuComponent } from "./chat-item-menu";

/** What the rows need from the sidebar around them (the list is a slot the layout streams in). */
export interface SidebarListContextValue {
  onNavigate: () => void;
}
export const SidebarListContext = createContext<SidebarListContextValue>({ onNavigate: () => {} });

// The row's Radix menu loads on first intent; the dialogs' chunk is preloaded in idle time (load-dialogs.ts).
// The row's hover tint matches the ghost button's, so the button hovers with a foreground wash instead. The dark
// variants are needed because the ghost variant's `dark:hover:bg-muted/50` outranks a plain `hover:` class.
const MENU_BUTTON =
  "size-10 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";
const loadChatItemMenu = chunk(() => import("./chat-item-menu").then((m) => m.ChatItemMenu));

/** The row owns the intent so a right-click anywhere on it opens the same menu as the ⋯ button. */
function ChatItemMenuOnIntent({
  intent,
  ...props
}: {
  intent: ReturnType<typeof useIntent<typeof ChatItemMenuComponent>>;
  title: string;
  pinned: boolean;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onDeleteAll?: () => void;
}) {
  if (intent.failed) throw intent.failed.error;
  const ChatItemMenu = intent.loaded;
  if (intent.armed && ChatItemMenu) {
    return <ChatItemMenu {...props} defaultOpen={intent.wanted === "menu"} triggerRef={intent.trigger} onCloseAutoFocus={intent.closed} />;
  }
  // Destructured: the compiler's lint takes an object one of whose fields is a `ref` for a ref itself.
  const { standIn } = intent;
  return (
    <IconButton ref={standIn} label={`Actions for ${props.title}`} tip={false} className={MENU_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
      <MoreHorizontal />
    </IconButton>
  );
}

/** Memoised, with handlers built from its chat, so a send or a switch re-renders two rows, not all. */
const SidebarRow = memo(function SidebarRow({
  chat,
  active,
  forked,
  nested,
  currentChatId,
  onNavigate,
  warm,
  show,
  children,
}: {
  chat: ChatSummary;
  active: boolean;
  /** A parent with forks carries the fork mark; its forks list beneath it while one of them is open. */
  forked: boolean;
  nested: boolean;
  currentChatId: string | null;
  onNavigate: () => void;
  warm: (chatId: string) => void;
  show: (render: (api: ModalApi) => React.ReactNode) => () => void;
  children?: React.ReactNode;
}) {
  const href = `/c/${chat.id}`;
  const intent = useIntent(loadChatItemMenu);
  const onRename = useCallback(
    () => loadDialogs().then(({ RenameDialog }) => show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />), () => {}),
    [chat, show],
  );
  const onDelete = useCallback(
    () =>
      loadDialogs().then(
        ({ DeleteDialog }) => show(({ open, close }) => <DeleteDialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
        () => {},
      ),
    [chat, currentChatId, show],
  );
  const onDeleteAll = useCallback(
    () =>
      loadDialogs().then(
        ({ DeleteAllDialog }) => show(({ open, close }) => <DeleteAllDialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
        () => {},
      ),
    [chat, currentChatId, show],
  );
  // Pin: the row moves at once; a refused request, or one that never reached the server (offline),
  // moves it back (patchChatOptimistic).
  const onTogglePin = useCallback(() => void patchChatOptimistic(getSidebarStore(), chat.id, { pinned: !chat.pinned }), [chat.id, chat.pinned]);
  return (
    <li data-chat-row={chat.id}>
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          intent.press("menu");
        }}
        className={cn(
          "group/item flex items-center justify-between gap-1 rounded-lg pr-0.5 transition-colors",
          // The menu is a portal, so the pointer leaving the row for it ended the hover; the open trigger keeps the row lit.
          active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70 active:bg-sidebar-accent has-[[aria-expanded=true]]:bg-sidebar-accent/70",
        )}
      >
        <Link
          href={href}
          prefetch={false}
          onClick={onNavigate}
          onNavigate={() => setPendingChat(chat.id === currentChatId ? null : chat.id)}
          onTouchStart={() => warm(chat.id)}
          onPointerEnter={(e) => {
            warm(chat.id);
            if (e.pointerType === "mouse") showRowTip(e.currentTarget, chat.title);
          }}
          onPointerLeave={hideRowTip}
          onPointerDown={hideRowTip}
          onFocus={(e) => {
            warm(chat.id);
            if (e.currentTarget.matches(":focus-visible")) showRowTip(e.currentTarget, chat.title);
          }}
          onBlur={hideRowTip}
          aria-current={active ? "page" : undefined}
          aria-label={forked ? `${chat.title}, has forks` : undefined}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center rounded-lg text-small", nested ? "pl-2" : "pl-3", active && "font-medium")}
        >
          {forked ? <GitFork aria-hidden className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{chat.title}</span>
        </Link>
        <ChunkBoundary label="chat menu" onRetry={intent.reset}>
          <ChatItemMenuOnIntent
            intent={intent}
            title={chat.title}
            pinned={Boolean(chat.pinned)}
            onRename={onRename}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            onDeleteAll={forked ? onDeleteAll : undefined}
          />
        </ChunkBoundary>
      </div>
      {children}
    </li>
  );
});

/** The chat list, server-rendered from the user's rows (the layout streams it into the sidebar's slot). */
export function SidebarList({ initialChats }: { initialChats: ChatSummary[] }) {
  const chats = useSidebarChats(initialChats);
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
