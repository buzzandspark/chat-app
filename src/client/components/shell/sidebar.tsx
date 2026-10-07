"use client";
import { MoreHorizontal, Plus, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";
import { cn } from "@/lib/utils";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useChatStore } from "@client/store/context";
import { prefetchChat } from "@client/store/prefetch";
import { setPendingChat, usePendingChat, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { useModals } from "../ui/modal-manager";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";

// D21: Radix menus and dialogs load on first intent, not at mount (next/dynamic keeps them out of the gate).
const MENU_BUTTON =
  "size-10 shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";
const ChatItemMenu = dynamic(() => import("./chat-item-menu").then((m) => m.ChatItemMenu), {
  ssr: false,
  loading: () => (
    <IconButton label="Chat actions" tipAlign="end" className={MENU_BUTTON} disabled>
      <MoreHorizontal />
    </IconButton>
  ),
});

const warmChatItemMenu = () => import("./chat-item-menu");

function ChatItemMenuOnIntent(props: { title: string; onRename: () => void; onDelete: () => void }) {
  const intent = useIntent(warmChatItemMenu);
  if (intent.armed) return <ChatItemMenu {...props} defaultOpen={intent.wanted === "menu"} />;
  return (
    <IconButton label={`Actions for ${props.title}`} tipAlign="end" className={MENU_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
      <MoreHorizontal />
    </IconButton>
  );
}
const RenameDialog = dynamic(() => import("./chat-dialogs").then((m) => m.RenameDialog), { ssr: false });
const DeleteDialog = dynamic(() => import("./chat-dialogs").then((m) => m.DeleteDialog), { ssr: false });

interface SidebarProps {
  initialChats: ChatSummary[];
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
  userLabel: string;
}

/** D0: overlay on phones, docked at md. Hover reveal of ⋯ keys off (hover: hover), not width. */
export function Sidebar({ initialChats, phoneOpen, desktopOpen, open, onClose, onNavigate, onSearch, userLabel }: SidebarProps) {
  const chats = useSidebarChats(initialChats);
  const pathname = usePathname();
  const router = useRouter();
  const { show } = useModals();
  const newChat = useNewChat();
  const store = useChatStore();
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;
  // D21: the clicked row is active at once; the router catches up when the thread arrives.
  const pendingChatId = usePendingChat();
  const activeChatId = pendingChatId ?? currentChatId;

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

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/30 backdrop-blur-[1px] transition-opacity md:hidden",
          phoneOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        aria-label="Chats"
        data-open={open}
        // Off-screen on a phone it is also out of the tab order and the accessibility tree.
        inert={!phoneOpen && !desktopOpen ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-full flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border transition-transform duration-200 ease-out",
          "safe-top pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]",
          phoneOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-0 md:w-72 md:translate-x-0 md:transition-[width,transform]",
          desktopOpen ? "md:flex" : "md:hidden",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-1 px-2">
          <span className="px-1 text-small font-semibold tracking-tight">Cadence</span>
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
            <IconButton label="Close sidebar" tipAlign="end" className="md:hidden" onClick={onClose}>
              <X />
            </IconButton>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-small text-muted-foreground">No chats yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((chat) => {
                const href = `/c/${chat.id}`;
                const active = chat.id === activeChatId;
                return (
                  <li
                    key={chat.id}
                    className={cn(
                      "group/item flex items-center justify-between gap-1 rounded-lg pr-0.5 transition-colors",
                      active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/70 active:bg-sidebar-accent",
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
                      title={chat.title}
                      onRename={() => show(({ open, close }) => <RenameDialog chat={chat} open={open} onOpenChange={(o) => !o && close()} />)}
                      onDelete={() =>
                        show(({ open, close }) => (
                          <DeleteDialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />
                        ))
                      }
                    />
                    </ChunkBoundary>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2">
          <span className="truncate text-caption text-muted-foreground">{userLabel}</span>
          <div className="flex items-center">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>

    </>
  );
}
