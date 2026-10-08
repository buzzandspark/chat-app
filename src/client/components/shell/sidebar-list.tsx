"use client";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, memo, useCallback, useContext, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { useChatStore } from "@client/store/context";
import { prefetchChat } from "@client/store/prefetch";
import { getSidebarStore, setPendingChat, usePendingChat, useSidebarChats, useSidebarGroups, type ChatSummary, type GroupSummary } from "@client/store/sidebar-store";
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
      <IconButton label="Chat actions" className={MENU_BUTTON} disabled>
        <MoreHorizontal />
      </IconButton>
    ),
  }),
);
const RenameDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.RenameDialog), { ssr: false }));
const DeleteDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.DeleteDialog), { ssr: false }));
const GroupNameDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.GroupNameDialog), { ssr: false }));
const DeleteGroupDialog = lazyChunk(() => dynamic(() => import("./dialogs").then((m) => m.DeleteGroupDialog), { ssr: false }));
const GroupItemMenu = lazyChunk(() =>
  dynamic(() => import("./chat-item-menu").then((m) => m.GroupItemMenu), {
    ssr: false,
    loading: () => (
      <IconButton label="Group actions" className={MENU_BUTTON} disabled>
        <MoreHorizontal />
      </IconButton>
    ),
  }),
);

async function patchChat(id: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

async function createGroup(name: string): Promise<GroupSummary | null> {
  try {
    const res = await fetch("/api/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) return null;
    return (await res.json()) as GroupSummary;
  } catch {
    return null;
  }
}

const warmChatItemMenu = () => import("./chat-item-menu");

/** The row owns the intent so a right-click anywhere on it opens the same menu as the ⋯ button. */
function ChatItemMenuOnIntent({
  intent,
  ...props
}: {
  intent: ReturnType<typeof useIntent>;
  title: string;
  pinned: boolean;
  groupId: string | null;
  groups: GroupSummary[];
  onRename: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  onNewGroup: () => void;
}) {
  if (intent.armed) {
    return <ChatItemMenu {...props} defaultOpen={intent.wanted === "menu"} onOpenChange={(o) => !o && intent.disarm()} />;
  }
  return (
    <IconButton label={`Actions for ${props.title}`} className={MENU_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
      <MoreHorizontal />
    </IconButton>
  );
}

/** One row; memoised, with handlers built from the chat it shows, so a send or a switch re-renders two rows, not all (#44). */
const SidebarRow = memo(function SidebarRow({
  chat,
  active,
  currentChatId,
  groups,
  onNavigate,
  warm,
  show,
}: {
  chat: ChatSummary;
  active: boolean;
  currentChatId: string | null;
  groups: GroupSummary[];
  onNavigate: () => void;
  warm: (chatId: string) => void;
  show: (render: (api: ModalApi) => React.ReactNode) => () => void;
}) {
  const href = `/c/${chat.id}`;
  const intent = useIntent(warmChatItemMenu);
  const onRename = useCallback(
    () => show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />),
    [chat, show],
  );
  const onDelete = useCallback(
    () => show(({ open, close }) => <DeleteDialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
    [chat, currentChatId, show],
  );
  // Pin and unpin: the row moves at once; the server is told, and told again on failure by the next load.
  const onTogglePin = useCallback(() => {
    const pinned = !chat.pinned;
    getSidebarStore().patch(chat.id, { pinned });
    void fetch(`/api/chats/${chat.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) }).then((res) => {
      if (!res.ok) getSidebarStore().patch(chat.id, { pinned: !pinned });
    });
  }, [chat.id, chat.pinned]);
  // Group membership: the row moves at once; a refused request moves it back.
  const onMoveToGroup = useCallback(
    (groupId: string | null) => {
      const before = chat.groupId ?? null;
      getSidebarStore().patch(chat.id, { groupId });
      void patchChat(chat.id, { groupId }).then((ok) => {
        if (!ok) getSidebarStore().patch(chat.id, { groupId: before });
      });
    },
    [chat.id, chat.groupId],
  );
  const onNewGroup = useCallback(
    () =>
      show(({ open, close }) => (
        <GroupNameDialog
          title="New group"
          open={open}
          onOpenChange={(o) => !o && close()}
          onSubmit={async (name) => {
            const group = await createGroup(name);
            if (!group) return false;
            getSidebarStore().addGroup(group);
            onMoveToGroup(group.id);
            return true;
          }}
        />
      )),
    [show, onMoveToGroup],
  );
  return (
    <li
      // The browser's own context menu gives way to the row's: a right-click opens the ⋯ menu.
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
        <ChatItemMenuOnIntent
          intent={intent}
          title={chat.title}
          pinned={Boolean(chat.pinned)}
          groupId={chat.groupId ?? null}
          groups={groups}
          onRename={onRename}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
          onMoveToGroup={onMoveToGroup}
          onNewGroup={onNewGroup}
        />
      </ChunkBoundary>
    </li>
  );
});

/** A group: a heading that collapses, its own ⋯ menu, and the rows inside. */
function GroupSection({
  group,
  chats,
  row,
  show,
}: {
  group: GroupSummary;
  chats: ChatSummary[];
  row: (chat: ChatSummary) => React.ReactNode;
  show: (render: (api: ModalApi) => React.ReactNode) => () => void;
}) {
  const intent = useIntent(warmChatItemMenu);
  const headingId = `sidebar-group-${group.id}`;
  const toggle = () => {
    const collapsed = !group.collapsed;
    getSidebarStore().patchGroup(group.id, { collapsed });
    void fetch(`/api/groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ collapsed }) }).catch(() => {});
  };
  const onRename = () =>
    show(({ open, close }) => (
      <GroupNameDialog
        title="Rename group"
        initial={group.name}
        open={open}
        onOpenChange={(o) => !o && close()}
        onSubmit={async (name) => {
          const res = await fetch(`/api/groups/${group.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
          if (!res?.ok) return false;
          getSidebarStore().patchGroup(group.id, { name });
          return true;
        }}
      />
    ));
  const onDelete = () => show(({ open, close }) => <DeleteGroupDialog group={group} open={open} onOpenChange={(o) => !o && close()} />);
  return (
    <section aria-labelledby={headingId}>
      <div
        className="group/item flex items-center justify-between gap-1 rounded-lg pr-0.5 hover:bg-sidebar-accent/70 has-[[aria-expanded=true]]:bg-sidebar-accent/70"
        onContextMenu={(e) => {
          e.preventDefault();
          intent.press("menu");
        }}
      >
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-lg pl-2 text-caption font-medium uppercase tracking-wide text-muted-foreground"
          aria-expanded={!group.collapsed}
          aria-controls={`${headingId}-chats`}
          onClick={toggle}
        >
          <ChevronRight className={cn("size-4 shrink-0 transition-transform", !group.collapsed && "rotate-90")} />
          <h2 id={headingId} className="truncate">
            {group.name}
          </h2>
          <span className="ml-1 tabular-nums">{chats.length}</span>
        </button>
        <ChunkBoundary label="group menu">
          {intent.armed ? (
            <GroupItemMenu name={group.name} onRename={onRename} onDelete={onDelete} defaultOpen={intent.wanted === "menu"} onOpenChange={(o) => !o && intent.disarm()} />
          ) : (
            <IconButton label={`Actions for group ${group.name}`} className={MENU_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
              <MoreHorizontal />
            </IconButton>
          )}
        </ChunkBoundary>
      </div>
      {group.collapsed ? null : (
        <ul id={`${headingId}-chats`} className="space-y-0.5">
          {chats.length > 0 ? chats.map(row) : <li className="px-3 py-2 text-caption text-muted-foreground">Empty</li>}
        </ul>
      )}
    </section>
  );
}

/** The chat list, server-rendered from the user's rows and groups (the layout streams it into the sidebar's slot). */
export function SidebarList({ initialChats, initialGroups }: { initialChats: ChatSummary[]; initialGroups: GroupSummary[] }) {
  const chats = useSidebarChats(initialChats);
  const groups = useSidebarGroups(initialGroups);
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

  if (chats.length === 0 && groups.length === 0) return <p className="px-2 py-3 text-small text-muted-foreground">No chats yet.</p>;
  const groupIds = new Set(groups.map((g) => g.id));
  const pinned = chats.filter((c) => c.pinned);
  const inGroup = new Map<string, ChatSummary[]>();
  const rest: ChatSummary[] = [];
  for (const c of chats) {
    if (c.pinned) continue;
    if (c.groupId && groupIds.has(c.groupId)) {
      const list = inGroup.get(c.groupId) ?? [];
      list.push(c);
      inGroup.set(c.groupId, list);
    } else rest.push(c);
  }
  const row = (chat: ChatSummary) => (
    <SidebarRow key={chat.id} chat={chat} active={chat.id === activeChatId} currentChatId={currentChatId} groups={groups} onNavigate={onNavigate} warm={warm} show={show} />
  );
  const heading = (id: string, text: string) => (
    <h2 id={id} className="px-3 pb-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
      {text}
    </h2>
  );
  const sectioned = pinned.length > 0 || groups.length > 0;
  return (
    <div className="space-y-3">
      {pinned.length > 0 ? (
        <section aria-labelledby="sidebar-pinned">
          {heading("sidebar-pinned", "Pinned")}
          <ul className="space-y-0.5">{pinned.map(row)}</ul>
        </section>
      ) : null}
      {groups.map((g) => (
        <GroupSection key={g.id} group={g} chats={inGroup.get(g.id) ?? []} row={row} show={show} />
      ))}
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
