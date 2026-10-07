"use client";
import { useEffect, useState } from "react";
import { textOf, type MessageState } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";

const SENTENCE_END = /[.!?](\s|$)/g;

/** Markdown to something a screen reader can say: code and tables become a short description (#55). */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)(```|$)/g, (_m, body: string) => ` Code block, ${body.split("\n").filter((l) => l.trim()).length} lines. `)
    .replace(/^\s*\|.*\|\s*$\n?(^\s*\|?[\s:|-]+\|?\s*$\n?)?((^\s*\|.*\|\s*$\n?)*)/gm, (_m, _d, rows: string) => ` Table with ${rows.split("\n").filter((l) => l.trim()).length} rows. `)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*|__|[*_~]/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function ending(m: MessageState): string | null {
  switch (m.status) {
    case "done":
      return m.stopReason === "max_tokens" ? "Reply cut off at the output limit." : "Reply finished.";
    case "stopped":
      return "Reply stopped.";
    case "interrupted":
      return "Reply interrupted.";
    case "refused":
      return "Claude declined to continue.";
    case "error":
      return `Reply failed: ${m.error?.message ?? "something went wrong"}.`;
    default:
      return null;
  }
}

/**
 * D19/#54: announces completed sentences at most every 2 s while a reply streams, then how it ended.
 * Only a reply that starts streaming while this chat is on screen is read; opening a chat says nothing.
 */
export function LiveRegion({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const chat = useChat(chatId);
  const lastId = chat.messageIds[chat.messageIds.length - 1];
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    if (!lastId) return;
    const first = store.getMessage(lastId);
    // Already finished when it came on screen: nothing to read aloud.
    if (!first || first.role !== "assistant" || first.status !== "streaming") return;
    let cursor = 0;
    let ended = false;
    const tick = () => {
      const m = store.getMessage(lastId);
      if (!m || m.role !== "assistant" || ended) return;
      const text = textOf(m.blocks);
      let end = cursor;
      SENTENCE_END.lastIndex = cursor;
      let match: RegExpExecArray | null;
      while ((match = SENTENCE_END.exec(text)) !== null) end = match.index + 1;
      if (m.status !== "streaming") end = text.length;
      const parts: string[] = [];
      if (end > cursor) {
        parts.push(speakable(text.slice(cursor, end)));
        cursor = end;
      }
      const how = ending(m);
      if (how) {
        parts.push(how);
        ended = true;
      }
      if (parts.length > 0) setAnnounced(parts.join(" "));
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
