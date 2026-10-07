"use client";
import { MoreHorizontal, Plus, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getSidebarStore, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { ThemeToggle } from "./theme-toggle";

// D21: Radix menus and dialogs load after first paint.
const ChatItemMenu = dynamic(() => import("./chat-item-menu").then((m) => m.ChatItemMenu), {
  ssr: false,
  loading: () => (
    <Button variant="ghost" size="icon" className="absolute right-0.5 top-1/2 size-10 -translate-y-1/2 text-muted-foreground opacity-0" aria-hidden disabled>
      <MoreHorizontal />
    </Button>
  ),
});
const RenameDialog = dynamic(() => import("./chat-dialogs").then((m) => m.RenameDialog), { ssr: false });
const DeleteDialog = dynamic(() => import("./chat-dialogs").then((m) => m.DeleteDialog), { ssr: false });

interface SidebarProps {
  initialChats: ChatSummary[];
  open: boolean;
  onClose: () => void;
  onSearch: () => void;
  userLabel: string;
}

/** D0: overlay on phones, docked at md. Hover reveal of ⋯ keys off (hover: hover), not width. */
export function Sidebar({ initialChats, open, onClose, onSearch, userLabel }: SidebarProps) {
  const chats = useSidebarChats();
  const pathname = usePathname();
  const router = useRouter();
  const [renaming, setRenaming] = useState<ChatSummary | null>(null);
  const [deleting, setDeleting] = useState<ChatSummary | null>(null);
  const currentChatId = /^\/c\/([0-9a-f-]{36})$/.exec(pathname ?? "")?.[1] ?? null;

  useEffect(() => {
    getSidebarStore().hydrate(initialChats);
  }, [initialChats]);

  // D21: prefetch the top five chats when the sidebar opens.
  useEffect(() => {
    if (!open) return;
    for (const chat of chats.slice(0, 5)) router.prefetch(`/c/${chat.id}`);
  }, [open, chats, router]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/30 backdrop-blur-[1px] transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        aria-label="Chats"
        data-open={open}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(20rem,85vw)] flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border transition-transform duration-200 ease-out",
          "safe-top pb-[env(safe-area-inset-bottom,0px)]",
          open ? "translate-x-0" : "-translate-x-full",
          "md:static md:z-0 md:w-72 md:translate-x-0 md:transition-[width,transform]",
          !open && "md:hidden",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-1 px-2">
          <span className="px-1 text-small font-semibold tracking-tight">Cadence</span>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="touch-target" aria-label="Search chats" onClick={onSearch}>
              <Search />
            </Button>
            <Button asChild variant="ghost" size="icon" className="touch-target" aria-label="New chat">
              <Link href="/c/new" onClick={onClose}>
                <Plus />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="touch-target md:hidden" aria-label="Close sidebar" onClick={onClose}>
              <X />
            </Button>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-small text-muted-foreground">No chats yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((chat) => {
                const href = `/c/${chat.id}`;
                const active = chat.id === currentChatId;
                return (
                  <li key={chat.id} className="group/item relative flex items-center">
                    <Link
                      href={href}
                      prefetch={false}
                      onClick={onClose}
                      onTouchStart={() => router.prefetch(href)}
                      onPointerEnter={() => router.prefetch(href)}
                      onFocus={() => router.prefetch(href)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 min-w-0 flex-1 items-center rounded-lg pl-3 pr-11 text-small transition-colors",
                        active ? "bg-sidebar-accent font-medium" : "hover:bg-sidebar-accent/70 active:bg-sidebar-accent",
                      )}
                    >
                      <span className="truncate">{chat.title}</span>
                    </Link>
                    <ChatItemMenu title={chat.title} onRename={() => setRenaming(chat)} onDelete={() => setDeleting(chat)} />
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-sidebar-border px-3 py-2">
          <span className="truncate text-caption text-muted-foreground">{userLabel}</span>
          <ThemeToggle />
        </div>
      </aside>
      {renaming ? <RenameDialog chat={renaming} onClose={() => setRenaming(null)} /> : null}
      {deleting ? <DeleteDialog chat={deleting} onClose={() => setDeleting(null)} currentChatId={currentChatId} /> : null}
    </>
  );
}
