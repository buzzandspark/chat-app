"use client";
import { useSyncExternalStore } from "react";
import { EMPTY_CHAT, getChatStore, type ChatState, type MessageState } from "./chat-store";

export function useMessage(id: string): MessageState | undefined {
  const store = getChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeMessage(id, cb),
    () => store.getMessage(id),
    () => store.getMessage(id),
  );
}

export function useChat(chatId: string): ChatState {
  const store = getChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeChat(chatId, cb),
    () => store.getChat(chatId),
    () => EMPTY_CHAT,
  );
}
