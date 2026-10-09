"use client";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@client/store/hooks";
import { prefetchChat } from "@client/store/prefetch";
import { getSidebarStore, setPendingChat, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";

export interface ForkTab {
  id: string;
  title: string;
}

/** The strip's model: the parent first, then its forks in stored order; null when the chat is neither. */
export function forkTabs(chats: readonly ChatSummary[], chatId: string): { parentId: string; tabs: ForkTab[] } | null {
  const me = chats.find((c) => c.id === chatId);
  const parentId = me?.forkedFrom ?? chatId;
  const forks = chats.filter((c) => c.forkedFrom === parentId).sort((a, b) => (a.forkOrder ?? 0) - (b.forkOrder ?? 0));
  if (forks.length === 0) return null;
  return { parentId, tabs: [{ id: parentId, title: "Main chat" }, ...forks.map((f) => ({ id: f.id, title: f.title }))] };
}

/** `id` takes `target`'s place; everything between shifts one step. */
export function moveBefore(ids: readonly string[], id: string, target: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from === -1 || to === -1 || from === to) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

const DRAG_PX = 6;

/** Browser-style tabs above the thread: the main chat, then its forks, reorderable by dragging with a mouse or pen. */
export function ForkTabs({ chatId }: { chatId: string }) {
  const chats = useSidebarChats();
  const model = forkTabs(chats, chatId);
  const router = useRouter();
  const store = useChatStore();
  const [dragging, setDragging] = useState<{ id: string; ids: string[] } | null>(null);
  const drag = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const warm = useCallback(
    (id: string) => {
      router.prefetch(`/c/${id}`);
      void prefetchChat(store, id);
    },
    [router, store],
  );
  const open = useCallback(
    (id: string) => {
      if (id === chatId) return;
      setPendingChat(id);
      router.push(`/c/${id}`);
    },
    [router, chatId],
  );

  if (!model) return null;
  const forkIds = dragging?.ids ?? model.tabs.slice(1).map((t) => t.id);
  const tabs = [model.tabs[0]!, ...forkIds.map((id) => model.tabs.find((t) => t.id === id)!)];

  const persist = (ids: string[]) => {
    const sidebar = getSidebarStore();
    ids.forEach((id, i) => sidebar.patch(id, { forkOrder: i }));
    void fetch(`/api/chats/${model.parentId}/fork-order`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    drag.current = { id, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_PX) return;
    d.moved = true;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-fork-tab]")?.dataset.forkTab;
    const ids = over && over !== d.id && forkIds.includes(over) ? moveBefore(forkIds, d.id, over) : forkIds;
    setDragging({ id: d.id, ids });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    suppressClick.current = true;
    if (dragging) persist(dragging.ids);
    setDragging(null);
  };

  return (
    <div role="tablist" aria-label="Chat and its forks" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 pt-1.5 [touch-action:pan-x] safe-x" data-testid="fork-tabs">
      {tabs.map((tab, i) => {
        const active = tab.id === chatId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-fork-tab={i === 0 ? undefined : tab.id}
            className={cn(
              "flex h-9 max-w-48 shrink-0 items-center rounded-t-lg border border-b-0 px-3 text-small whitespace-nowrap select-none",
              active ? "border-border bg-background font-medium" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              dragging?.id === tab.id && "opacity-60",
            )}
            onPointerEnter={() => warm(tab.id)}
            onFocus={() => warm(tab.id)}
            onPointerDown={i === 0 ? undefined : (e) => onPointerDown(e, tab.id)}
            onPointerMove={i === 0 ? undefined : onPointerMove}
            onPointerUp={i === 0 ? undefined : onPointerUp}
            onPointerCancel={i === 0 ? undefined : onPointerUp}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              open(tab.id);
            }}
          >
            <span className="truncate">{tab.title}</span>
          </button>
        );
      })}
    </div>
  );
}
