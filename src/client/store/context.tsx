"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ChatStore } from "./chat-store";
import { watchOptionsOnReplyEnd } from "./forks";
import { refreshUsage } from "./usage";

const ChatStoreContext = createContext<ChatStore | null>(null);

/** One store per shell: fresh per server render, long-lived on the client because the layout persists. */
export function ChatStoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => {
    const s = new ChatStore();
    s.onReplyEnd((reply) => watchOptionsOnReplyEnd(s, reply));
    s.onReplyEnd(refreshUsage);
    return s;
  });
  return <ChatStoreContext.Provider value={store}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore(): ChatStore {
  const store = useContext(ChatStoreContext);
  if (!store) throw new Error("useChatStore outside ChatStoreProvider");
  return store;
}
