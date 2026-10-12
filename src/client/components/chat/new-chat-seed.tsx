"use client";
import { useEffect } from "react";
import { useChatStore } from "@client/store/hooks";
import { useChatActions } from "./chat-context";

/** /c's counterpart of SeedChat: the new chat has no rows, so it is seeded empty during render (ADR-0005). */
export function NewChatSeed() {
  const { chatId } = useChatActions();
  const store = useChatStore();
  if (!store.getChat(chatId).seeded) store.seedChat(chatId, null, [], { deferNotify: true });
  useEffect(() => {
    // In-app New chat opens /c?n=<id> so each opens its own view; the address shows plain /c.
    if (window.location.pathname === "/c" && window.location.search) window.history.replaceState(null, "", "/c");
  }, []);
  return null;
}
