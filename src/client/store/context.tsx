"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ChatStore } from "./chat-store";

const ChatStoreContext = createContext<ChatStore | null>(null);

/**
 * One store per shell instance: a fresh one for every server render (no
 * cross-request accumulation) and a single long-lived one on the client,
 * because the (chat) layout persists across navigations.
 */
export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ChatStore());
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore(): ChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error("useChatStore outside ChatStoreProvider");
  return store;
}
