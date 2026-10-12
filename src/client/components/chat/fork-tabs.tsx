"use client";
import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@client/store/hooks";
import { prefetchChat } from "@client/store/prefetch";
import { getSidebarStore, setPendingChat, setTabHidden, useSidebarChats, type ChatSummary } from "@client/store/sidebar-store";
import { lazyChunk } from "../ui/lazy-chunk";
import { ExploreOutline } from "./explore-options";

const ForkTabMenu = lazyChunk(() => dynamic(() => import("./fork-tab-menu").then((m) => m.ForkTabMenu), { ssr: false }));

export interface ForkTab {
  id: string;
  title: string;
  hidden: boolean;
}

/** The strip's model: the parent first, then its forks in stored order; null when the chat is neither. */
export function forkTabs(chats: readonly ChatSummary[], chatId: string): { parentId: string; tabs: ForkTab[] } | null {
  const me = chats.find((c) => c.id === chatId);
  const parentId = me?.forkedFrom ?? chatId;
  const parent = chats.find((c) => c.id === parentId);
  const forks = chats.filter((c) => c.forkedFrom === parentId).sort((a, b) => (a.forkOrder ?? 0) - (b.forkOrder ?? 0));
  if (forks.length === 0) return null;
  return {
    parentId,
    tabs: [{ id: parentId, title: "Main chat", hidden: Boolean(parent?.tabHidden) }, ...forks.map((f) => ({ id: f.id, title: f.title, hidden: Boolean(f.tabHidden) }))],
  };
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

/**
 * Folder tabs on the composer's input: the main chat, then its forks. A closed tab stays closed until
 * the chat is opened again (from the sidebar); Ctrl+Shift+[ and ] cycle; a right-click offers Declare
 * winner and Delete chat; forks reorder by dragging with a mouse or pen.
 */
export function ForkTabs({ chatId }: { chatId: string }) {
  const chats = useSidebarChats();
  const model = forkTabs(chats, chatId);
  const router = useRouter();
  const store = useChatStore();
  const [dragging, setDragging] = useState<{ id: string; ids: string[] } | null>(null);
  const [menu, setMenu] = useState<{ tab: ForkTab; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; startX: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);

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

  const visible = model ? model.tabs.filter((t) => !t.hidden || t.id === chatId) : [];
  const visibleIds = visible.map((t) => t.id);
  const shown = visible.length >= 2;
  // Opening a closed tab's chat reopens the tab.
  const activeHidden = model?.tabs.find((t) => t.id === chatId)?.hidden ?? false;
  useEffect(() => {
    if (activeHidden) void setTabHidden(getSidebarStore(), chatId, false);
  }, [activeHidden, chatId]);
  // Ctrl+Shift+] and [ move to the next and previous tab, wrapping round.
  const visibleKey = shown ? visibleIds.join(",") : "";
  useEffect(() => {
    if (!visibleKey) return;
    const ids = visibleKey.split(",");
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
      const i = ids.indexOf(chatId);
      if (i === -1) return;
      e.preventDefault();
      open(ids[(i + (e.code === "BracketRight" ? 1 : ids.length - 1)) % ids.length]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleKey, chatId, open]);
  const closeMenu = useCallback(() => setMenu(null), []);
  // Before paint, so a strip that grows out of the Explore button never shows a frame at full size first.
  const parentId = model?.parentId ?? null;
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const morph = morphRef.current;
    // Loaded while the sheet was open, the chunk resolves in a microtask, still before the frame is painted.
    if (shown && parentId && strip && morph) void import("./tab-reveal").then((m) => m.playTabReveal(parentId, strip, morph));
  }, [shown, parentId]);

  if (!model || !shown) return null;
  const forkIds = dragging?.ids ?? model.tabs.slice(1).map((t) => t.id);
  const tabs = [model.tabs[0]!, ...forkIds.map((id) => model.tabs.find((t) => t.id === id)!)].filter((t) => !t.hidden || t.id === chatId);

  const persist = (ids: string[]) => {
    const sidebar = getSidebarStore();
    ids.forEach((id, i) => sidebar.patch(id, { forkOrder: i }));
    void fetch(`/api/chats/${model.parentId}/fork-order`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
  };
  const dismiss = (tab: ForkTab) => {
    if (tab.id === chatId) {
      const i = visibleIds.indexOf(tab.id);
      const next = visibleIds[i + 1] ?? visibleIds[i - 1];
      if (next) open(next);
    }
    void setTabHidden(getSidebarStore(), tab.id, true);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("[data-tab-close]")) return;
    drag.current = { id, startX: e.clientX, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_PX) return;
    // Capture only once this is a drag: a captured pointer sends the click to the wrapper, not the tab.
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
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
    // Overlaps the input's top border by a pixel, so the open tab covers it and joins the input.
    <div className="relative z-10 -mb-px">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Chat and its forks"
        className="flex gap-1 overflow-x-auto px-3 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [touch-action:pan-x]"
        data-testid="fork-tabs"
      >
        {tabs.map((tab) => {
          const active = tab.id === chatId;
          const isMain = tab.id === model.parentId;
          return (
            <div
              key={tab.id}
              data-tab-slot
              data-fork-tab={isMain ? undefined : tab.id}
              className={cn(
                "group/tab flex h-9 max-w-56 shrink-0 items-center rounded-t-lg border border-b-0 pr-1 select-none",
                active
                  ? "border-input bg-card group-has-[textarea:focus]/chat:border-ring"
                  : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/10",
                dragging?.id === tab.id && "opacity-60",
              )}
              onPointerEnter={() => warm(tab.id)}
              onPointerDown={isMain ? undefined : (e) => onPointerDown(e, tab.id)}
              onPointerMove={isMain ? undefined : onPointerMove}
              onPointerUp={isMain ? undefined : onPointerUp}
              onPointerCancel={isMain ? undefined : onPointerUp}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ tab, x: e.clientX, y: e.clientY });
              }}
              // On the wrapper: a drag's pointer capture delivers the click here, and a keyboard press on the tab bubbles up.
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                open(tab.id);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className={cn("flex h-full min-w-0 items-center pl-3 pr-1 text-small whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50", active && "font-medium")}
                onFocus={() => warm(tab.id)}
              >
                <span className="truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                data-tab-close
                aria-label={`Close tab ${tab.title}`}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tab:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
                  // Without hover only the open tab offers its ×, so a narrow row isn't half close buttons.
                  !active && "[@media(hover:none)]:hidden",
                )}
                onClick={() => dismiss(tab)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div ref={morphRef} aria-hidden className="pointer-events-none absolute isolate z-20 bg-background opacity-0 shadow-md">
        <ExploreOutline />
      </div>
      {menu ? <ForkTabMenu tabId={menu.tab.id} title={menu.tab.title} isMain={menu.tab.id === model.parentId} currentChatId={chatId} x={menu.x} y={menu.y} onClose={closeMenu} /> : null}
    </div>
  );
}
