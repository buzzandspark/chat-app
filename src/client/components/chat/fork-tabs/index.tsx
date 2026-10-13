"use client";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@client/store/hooks";
import { prefetchChat } from "@client/store/prefetch";
import { forkTabs, type ForkTab } from "@client/store/forks";
import { getSidebarStore, patchChat, setPendingChat, setTabHidden, useSidebarChats } from "@client/store/sidebar-store";
import { chunk } from "@client/components/ui/lazy-chunk";
import { useModals } from "@client/components/ui/modal-manager";
import type { ForkTabMenu } from "./fork-tab-menu";
import { ExploreOutline } from "../explore-outline";

const loadTabMenu = chunk(() => import("./fork-tab-menu").then((m) => m.ForkTabMenu));

// The open tab scrolls into view, clear of the fade at the strip's end, so its × can be reached.
const scrollOpenTabIntoView = (slot: HTMLDivElement | null) => slot?.scrollIntoView({ block: "nearest", inline: "nearest" });

/** The main chat and its forks as tabs. A closed tab stays closed until the chat is opened again from the sidebar. */
export function ForkTabs({ chatId }: { chatId: string }) {
  const chats = useSidebarChats();
  const model = forkTabs(chats, chatId);
  const router = useRouter();
  const store = useChatStore();
  const { openCount } = useModals();
  const [menu, setMenu] = useState<{ tab: ForkTab; x: number; y: number; Menu: typeof ForkTabMenu } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

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
  // Opening a closed tab's chat reopens the tab, but closing the open tab must not: it stays closed once
  // this view hides (Activity runs the cleanup then), and a later visit from the sidebar reopens it.
  const activeHidden = model?.tabs.find((t) => t.id === chatId)?.hidden ?? false;
  const closing = useRef<string | null>(null);
  useEffect(() => {
    if (!activeHidden) return;
    if (closing.current === chatId) {
      return () => {
        closing.current = null;
      };
    }
    // No rollback: a failed reopen would hide the tab again and rerun this, retrying in a loop.
    getSidebarStore().patch(chatId, { tabHidden: false });
    void patchChat(chatId, { tabHidden: false });
  }, [activeHidden, chatId]);
  // Ctrl+Shift+] and [ move to the next and previous tab, wrapping round; not while a dialog is up.
  const visibleKey = shown ? visibleIds.join(",") : "";
  useEffect(() => {
    if (!visibleKey || openCount > 0) return;
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
  }, [visibleKey, chatId, open, openCount]);
  // A press on the open tab closes its menu first (the menu's outside press); that same click must not reopen it.
  const menuClosedAt = useRef(0);
  const closeMenu = useCallback(() => {
    menuClosedAt.current = performance.now();
    setMenu(null);
  }, []);
  // The morph's ref runs at commit, before paint, so a strip growing out of the Explore button never paints at full size;
  // a chunk loaded while the sheet was open resolves in a microtask, still before paint.
  const parentId = model?.parentId ?? null;
  const attachMorph = (morph: HTMLDivElement | null) => {
    const strip = stripRef.current;
    if (parentId && strip && morph) void import("../tab-reveal").then((m) => m.playTabReveal(parentId, strip, morph));
  };

  if (!model || !shown) return null;

  const dismiss = (tab: ForkTab) => {
    if (tab.id === chatId) {
      closing.current = chatId;
      const i = visibleIds.indexOf(tab.id);
      const next = visibleIds[i + 1] ?? visibleIds[i - 1];
      if (next) open(next);
    }
    void setTabHidden(getSidebarStore(), tab.id, true);
  };

  return (
    // On a phone, CSS order moves the strip onto the composer's input as folder tabs overlapping its top border by a pixel,
    // so the open tab joins the input; no background there, so that border shows under the other tabs.
    <div className="relative z-10 order-1 -mb-px border-t border-border pt-2 safe-x dock:order-none dock:mb-0 dock:border-t-0 dock:bg-sidebar-accent dock:px-0! dock:pt-0 dock:shadow-[inset_0_-1px_0_var(--border)]">
      {/* Unpadded, so the reveal's outline is placed against exactly the strip's box. */}
      <div className="relative mx-auto max-w-thread dock:max-w-none">
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Chat and its forks"
          className="flex scroll-pr-6 gap-1 overflow-x-auto pr-6 pl-3 [mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] [touch-action:pan-x] dock:px-2 dock:pt-1.5"
          data-testid="fork-tabs"
        >
          {visible.map((tab) => {
            const active = tab.id === chatId;
            return (
              <div
                key={tab.id}
                ref={active ? scrollOpenTabIntoView : undefined}
                data-tab-slot
                className={cn(
                  "group/tab flex h-9 max-w-56 shrink-0 items-center rounded-t-lg border border-b-0 pr-1 select-none",
                  // The open tab joins what it sits on: the input (phone) or the thread below the strip (docked).
                  active
                    ? "border-input bg-card group-has-[textarea:focus]/chat:border-ring dock:border-border dock:bg-background dock:group-has-[textarea:focus]/chat:border-border"
                    : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground dark:hover:bg-foreground/10",
                )}
                onPointerEnter={() => warm(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const at = { tab, x: e.clientX, y: e.clientY };
                  loadTabMenu().then((Menu) => setMenu({ ...at, Menu }), () => {});
                }}
                // On the wrapper, so a keyboard press on the tab bubbles up.
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
                  if (!active) return open(tab.id);
                  if (performance.now() - menuClosedAt.current < 300) return;
                  // The open tab's menu drops from the docked strip and rises from the phone's tabs on the input.
                  const r = e.currentTarget.getBoundingClientRect();
                  const at = { tab, x: r.left, y: r.top < window.innerHeight / 2 ? r.bottom : r.top };
                  loadTabMenu().then((Menu) => setMenu({ ...at, Menu }), () => {});
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-haspopup={active ? "menu" : undefined}
                  aria-expanded={active ? menu?.tab.id === tab.id : undefined}
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
                    "flex size-6 shrink-0 items-center justify-center rounded-md [@media(hover:none)]:size-8 text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/tab:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
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
        <div ref={attachMorph} aria-hidden className="pointer-events-none absolute isolate z-20 bg-background opacity-0 shadow-md">
          <ExploreOutline />
        </div>
      </div>
      {menu ? <menu.Menu tabId={menu.tab.id} title={menu.tab.title} isMain={menu.tab.id === model.parentId} currentChatId={chatId} x={menu.x} y={menu.y} onClose={closeMenu} /> : null}
    </div>
  );
}
