"use client";
import { useEffect, useState } from "react";
import { textOf } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";

const SENTENCE_END = /[.!?](\s|$)/g;

/** D19: announces completed sentences at most every 2 s, so a reader hears prose, not tokens. */
export function LiveRegion({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const chat = useChat(chatId);
  const lastId = chat.messageIds[chat.messageIds.length - 1];
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    if (!lastId) return;
    let cursor = 0;
    const tick = () => {
      const m = store.getMessage(lastId);
      if (!m || m.role !== "assistant") return;
      const text = textOf(m.blocks);
      let end = cursor;
      SENTENCE_END.lastIndex = cursor;
      let match: RegExpExecArray | null;
      while ((match = SENTENCE_END.exec(text)) !== null) end = match.index + 1;
      if (m.status !== "streaming") end = text.length;
      if (end > cursor) {
        setAnnounced(text.slice(cursor, end).trim());
        cursor = end;
      }
    };
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, [lastId, store]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announced}
    </div>
  );
}
