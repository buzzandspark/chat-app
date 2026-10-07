"use client";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useChatStore } from "@client/store/context";
import { uuidv7 } from "@shared/id";

/** A new chat is a fresh id with no rows; the engine creates the row on the first send (ADR-0005). */
export function newChatHref(): string {
  return `/c/${uuidv7()}`;
}

export function useNewChat(): () => void {
  const router = useRouter();
  const store = useChatStore();
  return useCallback(() => {
    const id = uuidv7();
    store.createChat(id);
    router.push(`/c/${id}`);
  }, [router, store]);
}
