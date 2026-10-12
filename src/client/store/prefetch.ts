"use client";
import { getGenerationClient } from "../transport/generation-client";
import type { ChatStore, SeedRow } from "./chat-store";

interface ChatJson {
  chat: { id: string; title: string; updatedAt: number; forkedFrom?: string | null; forkPosition?: number | null };
  messages: SeedRow[];
  older?: number;
}

const forkOf = (chat: ChatJson["chat"]) => ({ from: chat.forkedFrom ?? null, position: chat.forkPosition ?? null });

/** #47: the rest of a long chat, on request; the store's id list becomes the full one. */
export async function loadEarlierMessages(store: ChatStore, chatId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${chatId}?all=1`);
    if (!res.ok) return false;
    const data = (await res.json()) as ChatJson;
    store.seedChat(chatId, data.chat.title, data.messages, { older: 0, fork: forkOf(data.chat) });
    return true;
  } catch {
    return false;
  }
}

const inflight = new Map<string, Promise<void>>();

/**
 * D21: fetch a chat's rows into the store on intent (hover, focus, touchstart, sidebar open), so the
 * click that follows renders from memory. A seeded chat is skipped; a 404 marks the chat empty.
 */
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
      const data = (await res.json()) as ChatJson;
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
