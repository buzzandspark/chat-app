"use client";
import { ArrowDown } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChat, useChatStore } from "@client/store/hooks";
import { loadEarlierMessages } from "@client/store/prefetch";
import { MessageRow } from "./message-row";

export interface MessageListHandle {
  engage: () => void;
  /** Stop following without scrolling (a user opened something they want to read). */
  disengage: () => void;
}

const DISENGAGE_PX = 48;

/**
 * D16 auto-follow by intent (#27): a wheel or touch scroll upwards, or a scroll key, disengages at once;
 * a scrollbar drag that leaves the end by 48 px disengages too; reaching the end or sending re-engages.
 * A content shrink (a thinking block collapsing) moves scrollTop without any of those and keeps following.
 * D14: rows use content-visibility.
 */
export const MessageList = forwardRef<MessageListHandle, { chatId: string; onFollowChange?: (engaged: boolean) => void }>(
  function MessageList({ chatId, onFollowChange }, ref) {
    const chat = useChat(chatId);
    const store = useChatStore();
    const [loadingEarlier, setLoadingEarlier] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const endRef = useRef<HTMLDivElement>(null);
    const [engaged, setEngagedState] = useState(true);
    const engagedRef = useRef(true);
    const lastTopRef = useRef(0);

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

    // Intent, not position: an upward wheel, an upward touch drag or a scroll key means "I am reading".
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      let touchY = 0;
      const onWheel = (e: WheelEvent) => {
        if (e.deltaY < 0) setEngaged(false);
      };
      const onTouchStart = (e: TouchEvent) => {
        touchY = e.touches[0]?.clientY ?? 0;
      };
      const onTouchMove = (e: TouchEvent) => {
        const y = e.touches[0]?.clientY ?? touchY;
        if (y - touchY > 4) setEngaged(false);
        touchY = y;
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home") setEngaged(false);
      };
      el.addEventListener("wheel", onWheel, { passive: true });
      el.addEventListener("touchstart", onTouchStart, { passive: true });
      el.addEventListener("touchmove", onTouchMove, { passive: true });
      el.addEventListener("keydown", onKey);
      return () => {
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("keydown", onKey);
      };
    }, [setEngaged]);

    // With per-frame store flushes the ResizeObserver fires at most once per frame. The scroller
    // itself is observed too: when the Android keyboard opens the viewport shrinks and the thread
    // must stay pinned to its end.
    useEffect(() => {
      const el = scrollRef.current;
      const inner = endRef.current?.parentElement;
      if (!el || !inner) return;
      const ro = new ResizeObserver(() => {
        if (engagedRef.current) el.scrollTop = el.scrollHeight;
      });
      ro.observe(inner);
      ro.observe(el);
      return () => ro.disconnect();
    }, [chatId]);

    // Before paint, so a long chat appears already at its end instead of oldest-first and then jumping.
    // Once per chat: when Activity re-reveals this list the effect runs again, and the reading position must stay.
    const scrolledForRef = useRef<string | null>(null);
    useLayoutEffect(() => {
      if (scrolledForRef.current === chatId) return;
      scrolledForRef.current = chatId;
      scrollToBottom();
      lastTopRef.current = scrollRef.current?.scrollTop ?? 0;
    }, [chatId, scrollToBottom]);

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
    }, [setEngaged]);

    return (
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-full overflow-y-auto overscroll-contain scroll-pb-4 [scrollbar-gutter:stable]"
          data-testid="message-list"
        >
          <div className="mx-auto flex w-full max-w-thread flex-col gap-5 safe-x py-4 md:py-6">
            {chat.older > 0 ? (
              <div className="flex justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="touch-target"
                  disabled={loadingEarlier}
                  onClick={() => {
                    setLoadingEarlier(true);
                    void loadEarlierMessages(store, chatId).finally(() => setLoadingEarlier(false));
                  }}
                >
                  {loadingEarlier ? "Loading…" : `Show ${chat.older} earlier message${chat.older === 1 ? "" : "s"}`}
                </Button>
              </div>
            ) : null}
            {chat.messageIds.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-16 text-center text-small text-muted-foreground">
                Ask anything. Replies keep streaming even if you switch apps.
              </div>
            ) : (
              chat.messageIds.map((id) => <MessageRow key={id} id={id} />)
            )}
            <div ref={endRef} className="h-px" />
          </div>
        </div>
        {!engaged ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              className="pointer-events-auto touch-target rounded-full shadow-md"
              onClick={engage}
              aria-label="Jump to latest"
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
