"use client";
import { getGenerationClient } from "../transport/generation-client";
import { readJson, type ChatResponse } from "@shared/api";
import type { ChatStore } from "./chat-store";

const forkOf = (chat: ChatResponse["chat"]) => ({ from: chat.forkedFrom ?? null, position: chat.forkPosition ?? null });

/** The rest of a long chat, on request; the store's id list becomes the full one. */
export async function loadEarlierMessages(store: ChatStore, chatId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${chatId}?all=1`);
    if (!res.ok) return false;
    const data = await readJson<ChatResponse>(res);
    store.seedChat(chatId, data.chat.title, data.messages, { older: 0, fork: forkOf(data.chat) });
    return true;
  } catch {
    return false;
  }
}

const inflight = new Map<string, Promise<void>>();

/** Fetches on intent (hover, focus, touchstart) so the click that follows renders from memory. */
export function prefetchChat(store: ChatStore, chatId: string): Promise<void> {
  if (store.getChat(chatId).seeded) return Promise.resolve();
  const existing = inflight.get(chatId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const res = await fetch(`/api/chats/${chatId}`);
      if (res.status === 404) {
        store.seedChat(chatId, null, []);
        return;
      }
      if (!res.ok) return;
      const data = await readJson<ChatResponse>(res);
      store.seedChat(chatId, data.chat.title, data.messages, { older: data.older ?? 0, fork: forkOf(data.chat) });
      // A reply still streaming on the server reattaches now, so the chat is current when opened.
      const client = getGenerationClient(store);
      for (const row of data.messages) {
        if (row.role === "assistant" && row.status === "streaming" && row.generationId) client.attach(row.generationId, row.id);
      }
    } catch {
      // Offline or aborted: the navigation's own seed still arrives.
    } finally {
      inflight.delete(chatId);
    }
  })();
  inflight.set(chatId, p);
  return p;
}
