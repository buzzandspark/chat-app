"use client";
import { GitFork, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { getSidebarStore, patchChatOptimistic, setPendingChat, type ChatSummary } from "@client/store/sidebar-store";
import { ChunkBoundary } from "@client/components/ui/chunk-boundary";
import { IconButton } from "@client/components/ui/icon-button";
import { chunk } from "@client/components/ui/lazy-chunk";
import { openDialog } from "../load-dialogs";
import { hideRowTip, showRowTip } from "./row-tip";
import type { ModalApi } from "@client/components/ui/modal-manager";
import type { ChatItemMenu as ChatItemMenuComponent } from "./chat-item-menu";

// The row's Radix menu loads on first intent; the dialogs' chunk is preloaded in idle time (load-dialogs.tsx).
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
  onDeclareWinner?: () => void;
  onDeleteForks?: () => void;
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
export const SidebarRow = memo(function SidebarRow({
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
  const onRename = useCallback(() => openDialog(show, "RenameDialog", chat, currentChatId), [chat, currentChatId, show]);
  const onDelete = useCallback(() => openDialog(show, "DeleteDialog", chat, currentChatId), [chat, currentChatId, show]);
  const onDeleteAll = useCallback(() => openDialog(show, "DeleteAllDialog", chat, currentChatId), [chat, currentChatId, show]);
  const onDeclareWinner = useCallback(() => openDialog(show, "DeclareWinnerDialog", chat, currentChatId), [chat, currentChatId, show]);
  const onDeleteForks = useCallback(() => openDialog(show, "DeleteForksDialog", chat, currentChatId), [chat, currentChatId, show]);
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
            onDeclareWinner={chat.forkedFrom ? onDeclareWinner : undefined}
            onDeleteForks={forked ? onDeleteForks : undefined}
          />
        </ChunkBoundary>
      </div>
      {children}
    </li>
  );
});
