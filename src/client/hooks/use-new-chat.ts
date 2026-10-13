"use client";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useChatStore } from "@client/store/context";
import { uuidv7 } from "@shared/id";

/** A new chat lives at /c until its first send creates the row (ADR-0005). */
export function newChatHref(): string {
  return "/c";
}

export function useNewChat(): () => void {
  const router = useRouter();
  const store = useChatStore();
  return useCallback(() => {
    const id = uuidv7();
    store.createChat(id);
    // `n` tells the kept /c view which chat to show; /c drops it once the view has it.
    router.push(`/c?n=${id}`);
  }, [router, store]);
}
