"use client";
import { ArrowDown } from "lucide-react";
import { Fragment, forwardRef, useCallback, useImperativeHandle, useRef, useState, type KeyboardEvent, type TouchEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import { useChat, useChatStore } from "@client/store/hooks";
import { loadEarlierMessages } from "@client/store/prefetch";
import { ForkDivider } from "./fork-divider";
import { MessageRow } from "./message-row";
import { QueuedRow } from "./queued-row";
import { clearSearchHit, onSearchHit, searchHitFor } from "@client/store/search-reveal";
import { NewChatPrompt } from "../thread-skeleton";

export interface MessageListHandle {
  engage: () => void;
  /** Stop following without scrolling (a user opened something they want to read). */
  disengage: () => void;
}

const DISENGAGE_PX = 48;
// Earlier messages load once the reader is this close to the top.
const LOAD_EARLIER_PX = 400;

/**
 * Auto-follow by intent: an upward wheel/touch scroll or a scroll key disengages at once, as does a scrollbar drag
 * 48 px from the end; reaching the end or sending re-engages. Rows use content-visibility.
 */
export const MessageList = forwardRef<MessageListHandle, { chatId: string; onFollowChange?: (engaged: boolean) => void }>(
  function MessageList({ chatId, onFollowChange }, ref) {
    const chat = useChat(chatId);
    const store = useChatStore();
    const [loadingEarlier, setLoadingEarlier] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [engaged, setEngagedState] = useState(true);
    const engagedRef = useRef(true);
    const lastTopRef = useRef(0);
    // While earlier messages load and land above, the reading position is held by its distance from the bottom.
    const holdRef = useRef<number | null>(null);

    const setEngaged = useCallback(
      (value: boolean) => {
        if (engagedRef.current === value) return;
        engagedRef.current = value;
        setEngagedState(value);
        onFollowChange?.(value);
      },
      [onFollowChange],
    );

    const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    }, []);

    const engage = useCallback(() => {
      setEngaged(true);
      scrollToBottom("smooth");
    }, [setEngaged, scrollToBottom]);
    const disengage = useCallback(() => setEngaged(false), [setEngaged]);

    useImperativeHandle(ref, () => ({ engage, disengage }), [engage, disengage]);

    // Intent, not position. Only in the thread itself (React events bubble here from portals such as a row's menu),
    // and only when it can scroll: a chat that fits has no "latest" to jump back to.
    const touchY = useRef(0);
    const inThread = (e: { currentTarget: HTMLElement; target: EventTarget }) =>
      e.target instanceof Node && e.currentTarget.contains(e.target) && e.currentTarget.scrollHeight - e.currentTarget.clientHeight > 2;
    const onWheel = (e: WheelEvent<HTMLDivElement>) => {
      if (inThread(e) && e.deltaY < 0) setEngaged(false);
    };
    const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
      touchY.current = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
      const y = e.touches[0]?.clientY ?? touchY.current;
      if (inThread(e) && y - touchY.current > 4) setEngaged(false);
      touchY.current = y;
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      if (inThread(e) && (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home")) setEngaged(false);
    };

    // Before paint, a long chat starts at its end (once per chat: Activity re-attaches on reveal). The observer then
    // keeps a following thread pinned as content grows or the viewport shrinks (Android keyboard), at most once per frame.
    const scrolledForRef = useRef<string | null>(null);
    // A search hit in this chat is shown instead of the end once its row is here: tried on attach, as rows land,
    // and when a search picks this chat while it is open.
    const revealLoadingRef = useRef(false);
    const tryReveal = useCallback(() => {
      const el = scrollRef.current;
      const hit = searchHitFor(chatId);
      if (!el || !hit || store.getChat(chatId).messageIds.length === 0) return;
      const row = el.querySelector(`[data-message-id="${CSS.escape(hit.messageId)}"]`);
      if (row) {
        clearSearchHit();
        setEngaged(false);
        void import("./search-match").then(({ showMatch }) => showMatch(el, row, hit.query));
      } else if (store.getChat(chatId).older > 0) {
        if (revealLoadingRef.current) return;
        revealLoadingRef.current = true;
        void loadEarlierMessages(store, chatId).finally(() => (revealLoadingRef.current = false));
      } else clearSearchHit();
    }, [chatId, store, setEngaged]);
    const attachScroller = useCallback(
      (el: HTMLDivElement | null) => {
        scrollRef.current = el;
        const inner = el?.firstElementChild;
        if (!el || !inner) return;
        if (scrolledForRef.current !== chatId) {
          scrolledForRef.current = chatId;
          el.scrollTop = el.scrollHeight;
          lastTopRef.current = el.scrollTop;
        }
        tryReveal();
        const ro = new ResizeObserver(() => {
          if (holdRef.current !== null) el.scrollTop = el.scrollHeight - holdRef.current;
          else if (engagedRef.current) el.scrollTop = el.scrollHeight;
          if (searchHitFor(chatId)) tryReveal();
        });
        ro.observe(inner);
        ro.observe(el);
        const off = onSearchHit(tryReveal);
        return () => {
          ro.disconnect();
          off();
          scrollRef.current = null;
        };
      },
      [chatId, tryReveal],
    );

    const onScroll = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const movedUp = lastTopRef.current - el.scrollTop;
      lastTopRef.current = el.scrollTop;
      // Only a scroll that leaves the end disengages; a content shrink (a thinking block collapsing)
      // moves scrollTop up without leaving the end and must keep following.
      if (movedUp > 0 && distance > DISENGAGE_PX) setEngaged(false);
      else if (distance <= 2) setEngaged(true);
      if (el.scrollTop < LOAD_EARLIER_PX && chat.older > 0 && !loadingEarlier) {
        setLoadingEarlier(true);
        holdRef.current = el.scrollHeight - el.scrollTop;
        void loadEarlierMessages(store, chatId).finally(() => {
          setLoadingEarlier(false);
          // Released a frame after the rows have rendered and the observer has placed them.
          requestAnimationFrame(() => requestAnimationFrame(() => (holdRef.current = null)));
        });
      }
    }, [setEngaged, chat.older, loadingEarlier, store, chatId]);

    return (
      <div className="relative min-h-0 flex-1">
        {/* Over the thread, not in it, so it adds no height above the rows the reader is on. */}
        {loadingEarlier ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center" role="status" data-testid="loading-earlier">
            <span className="rounded-full bg-sidebar-accent px-3 py-1 text-caption text-muted-foreground shadow-sm">Loading earlier messages…</span>
          </div>
        ) : null}
        <div
          ref={attachScroller}
          onScroll={onScroll}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onKeyDown={onKeyDown}
          className="h-full overflow-y-auto overscroll-contain scroll-pb-4 [scrollbar-gutter:stable]"
          data-testid="message-list"
        >
          <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6">
            {chat.messageIds.length === 0 ? (
              <NewChatPrompt />
            ) : (
              chat.messageIds.map((id) => (
                <Fragment key={id}>
                  {chat.forkPosition !== null && store.getMessage(id)?.position === chat.forkPosition ? <ForkDivider parentId={chat.forkedFrom} /> : null}
                  <MessageRow id={id} />
                </Fragment>
              ))
            )}
            {chat.queue.map((item) => (
              <QueuedRow key={item.id} item={item} lastId={chat.messageIds.at(-1)} />
            ))}
            {/* Taller while Explore options floats over the thread's end, so the last reply's actions stay clear. */}
            <div className="h-px group-has-[[data-explore=shown]]/chat:h-8" />
          </div>
        </div>
        {!engaged ? (
          // Stacked above Explore options while that button is up in the same spot.
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center transition-[bottom] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-has-[[data-explore=shown]]/chat:bottom-16 motion-reduce:transition-none">
            <Button
              size="sm"
              variant="outline"
              className="pointer-events-auto touch-target rounded-full bg-sidebar-accent shadow-md hover:bg-sidebar-accent hover:brightness-95 dark:bg-sidebar-accent dark:hover:bg-sidebar-accent"
              onClick={engage}
            >
              <ArrowDown data-icon="inline-start" />
              Jump to latest
            </Button>
          </div>
        ) : null}
      </div>
    );
  },
);
