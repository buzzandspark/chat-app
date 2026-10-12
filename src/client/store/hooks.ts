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

/**
 * Whether the chat's rows are in the store. The server snapshot is always false: the server renders
 * the skeleton, hydration matches it, and React re-renders with the seeded store before paint.
 */
export function useChatSeeded(chatId: string): boolean {
  const store = useChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeChat(chatId, cb),
    () => store.getChat(chatId).seeded,
    () => false,
  );
}

/** Whether the composer can name the chat's model; false on the server and in hydration, like useChatSeeded. */
export function useChatSettingsKnown(chatId: string): boolean {
  const store = useChatStore();
  return useSyncExternalStore(
    (cb) => store.subscribeChat(chatId, cb),
    () => store.settingsKnown(chatId),
    () => false,
  );
}

export { useChatStore } from "./context";
