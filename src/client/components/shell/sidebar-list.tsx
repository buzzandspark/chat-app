"use client";
import { MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, memo, useCallback, useContext, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { useChatStore } from "@client/store/context";
import { prefetchChat } from "@client/store/prefetch";
import { setPendingChat, usePendingChat, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { IconButton } from "../ui/icon-button";
import { lazyChunk } from "../ui/lazy-chunk";
import { useModals, type ModalApi } from "../ui/modal-manager";

/** What the rows need from the sidebar around them (the list is a slot the layout streams in, #20). */
export interface SidebarListContextValue {
  open: boolean;
  onNavigate: () => void;
}
export const SidebarListContext = createContext<SidebarListContextValue>({ open: false, onNavigate: () => {} });

// D21: Radix menus and dialogs load on first intent, not at mount (next/dynamic keeps them out of the gate).
// The row's hover tint and the ghost button's hover tint are the same colour, so the button's own hover
// was invisible: it now takes a wash of the foreground and the full foreground colour. The dark variants
// are needed because the ghost variant's own `dark:hover:bg-muted/50` outranks a plain `hover:` class.
const MENU_BUTTON =
  "size-10 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";
const ChatItemMenu = lazyChunk(() =>
  dynamic(() => import("./chat-item-menu").then((m) => m.ChatItemMenu), {
    ssr: false,
    loading: () => (
      <IconButton label="Chat actions" tipAlign="end" className={MENU_BUTTON} disabled>
        <MoreHorizontal />
      </IconButton>
    ),
  }),
);
const RenameDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.RenameDialog), { ssr: false }));
const DeleteDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.DeleteDialog), { ssr: false }));

const warmChatItemMenu = () => import("./chat-item-menu");

function ChatItemMenuOnIntent(props: { title: string; onRename: () => void; onDelete: () => void }) {
  const intent = useIntent(warmChatItemMenu);
  if (intent.armed) {
    return <ChatItemMenu {...props} defaultOpen={intent.wanted === "menu"} onOpenChange={(o) => !o && intent.disarm()} />;
  }
  return (
    <IconButton label={`Actions for ${props.title}`} tipAlign="end" className={MENU_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
      <MoreHorizontal />
    </IconButton>
  );
}

/** One row; memoised, with handlers built from the chat it shows, so a send or a switch re-renders two rows, not all (#44). */
const SidebarRow = memo(function SidebarRow({
  chat,
  active,
  currentChatId,
  onNavigate,
  warm,
  show,
}: {
  chat: ChatSummary;
  active: boolean;
  currentChatId: string | null;
  onNavigate: () => void;
  warm: (chatId: string) => void;
  show: (render: (api: ModalApi) => React.ReactNode) => () => void;
}) {
  const href = `/c/${chat.id}`;
  const onRename = useCallback(
    () => show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />),
    [chat, show],
  );
  const onDelete = useCallback(
    () => show(({ open, close }) => <DeleteDialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
    [chat, currentChatId, show],
  );
  return (
    <li
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
        onNavigate={() => setPendingChat(chat.id)}
        onTouchStart={() => warm(chat.id)}
        onPointerEnter={() => warm(chat.id)}
        onFocus={() => warm(chat.id)}
        aria-current={active ? "page" : undefined}
        className={cn("flex min-h-11 min-w-0 flex-1 items-center rounded-lg pl-3 text-small", active && "font-medium")}
      >
        <span className="truncate">{chat.title}</span>
      </Link>
      <ChunkBoundary label="chat menu">
        <ChatItemMenuOnIntent title={chat.title} onRename={onRename} onDelete={onDelete} />
      </ChunkBoundary>
    </li>
  );
});

/** The chat list, server-rendered from the user's rows (the layout streams it into the sidebar's slot). */
export function SidebarList({ initialChats }: { initialChats: ChatSummary[] }) {
  const chats = useSidebarChats(initialChats);
  const { open, onNavigate } = useContext(SidebarListContext);
  const pathname = usePathname();
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  // D21: the clicked row is active at once; the router catches up when the thread arrives.
  const pendingChatId = usePendingChat();
  const activeChatId = pendingChatId ?? currentChatId;
  const router = useRouter();
  const store = useChatStore();
  const { show } = useModals();

  // D21: on intent (hover, focus, touchstart) and for the top five when the sidebar opens, warm the
  // route shell and seed the chat's rows into the store, so the click renders from memory (ADR-0005).
  const warm = useCallback(
    (chatId: string) => {
      router.prefetch(`/c/${chatId}`);
      void prefetchChat(store, chatId);
    },
    [router, store],
  );
  useEffect(() => {
    if (!open) return;
    for (const chat of chats.slice(0, 5)) warm(chat.id);
  }, [open, chats, warm]);

  if (chats.length === 0) return <p className="px-2 py-3 text-small text-muted-foreground">No chats yet.</p>;
  return (
    <ul className="space-y-0.5">
      {chats.map((chat) => (
        <SidebarRow key={chat.id} chat={chat} active={chat.id === activeChatId} currentChatId={currentChatId} onNavigate={onNavigate} warm={warm} show={show} />
      ))}
    </ul>
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
