"use client";
import { useSyncExternalStore } from "react";
import type { ChatState, MessageState } from "./chat-store";
import { useChatStore } from "./context";

export function useMessage(id: string): MessageState | undefined {
  const store = useChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeMessage(id, cb),
    () => store.getMessage(id),
    () => store.getMessage(id),
  );
}

export function useChat(chatId: string): ChatState {
  const store = useChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeChat(chatId, cb),
    () => store.getChat(chatId),
    () => store.getChat(chatId),
  );
}

export { useChatStore } from "./context";
