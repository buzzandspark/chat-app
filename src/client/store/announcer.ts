"use client";
import { useSyncExternalStore } from "react";
import type { RelayError } from "@shared/types";
import { textOf, type ChatStore, type MessageState } from "./chat-store";

const SENTENCE_END = /[.!?](\s|$)/g;

/** Code and tables become a short description for screen readers. */
function speakable(markdown: string): string {
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

/** One plain sentence per failure, shared by the reply's footer and the live region; never the server's own text. */
export function errorText(error: RelayError | null | undefined): string {
  switch (error?.kind) {
    case "rate_limited":
      return "Rate limited.";
    case "overloaded":
      return "Claude is overloaded.";
    case "api_error":
      return "Claude returned an error.";
    case "auth":
      return "The server's API key was rejected. Contact the admin.";
    case "session":
      return "Your session has ended.";
    case "forbidden":
      return "This chat belongs to another account.";
    case "guests_blocked":
      return "Guests can't send messages right now.";
    case "quota_exceeded":
      return "You've reached your spending cap.";
    case "context_full":
      return "This chat is too long to continue.";
    case "network":
      return "Lost the connection to Claude.";
    case "offline":
      return "Couldn't send this message.";
    case "unavailable":
      return "The server is restarting.";
    case "gone":
      return "This chat was deleted.";
    case "conflict":
      return error.retryable ? "An earlier reply was still finishing." : "This chat has changed since you opened it.";
    default:
      return "Something went wrong.";
  }
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
      return `Reply failed: ${errorText(m.error)}`;
    default:
      return null;
  }
}

// Live region text, kept outside React. A followed reply announces completed sentences at most every 2 s,
// then how it ended; a chat opened on a finished reply says nothing.
const said = new Map<string, string>();
const listeners = new Set<() => void>();
const following = new Set<string>();

export function followReply(store: ChatStore, chatId: string, messageId: string): void {
  if (typeof window === "undefined" || window.location.pathname !== `/c/${chatId}` || following.has(messageId)) return;
  if (store.getMessage(messageId)?.status !== "streaming") return;
  following.add(messageId);
  let cursor = 0;
  const stop = () => {
    clearInterval(timer);
    following.delete(messageId);
  };
  const timer = setInterval(() => {
    const m = store.getMessage(messageId);
    if (!m || m.role !== "assistant") {
      stop();
      return;
    }
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
      stop();
    }
    if (parts.length === 0) return;
    said.set(chatId, parts.join(" "));
    for (const listener of listeners) listener();
  }, 2000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAnnouncement(chatId: string): string {
  return useSyncExternalStore(
    subscribe,
    () => said.get(chatId) ?? "",
    () => "",
  );
}
