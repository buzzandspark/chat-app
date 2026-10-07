"use client";
import type { ChatStore, SeedRow } from "./chat-store";

interface ChatJson {
  chat: { id: string; title: string; updatedAt: number };
  messages: SeedRow[];
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
      store.seedChat(chatId, data.chat.title, data.messages);
    } catch {
      // Offline or aborted: the navigation's own seed still arrives.
    } finally {
      inflight.delete(chatId);
    }
  })();
  inflight.set(chatId, p);
  return p;
}
