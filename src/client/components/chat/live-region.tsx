"use client";
import { useCallback } from "react";
import { followReply, useAnnouncement } from "@client/store/announcer";
import { useChatStore } from "@client/store/hooks";

/**
 * D19/#54: the chat's screen-reader announcements (store/announcer.ts decides what and when). Coming on screen
 * (mounted, or revealed by Activity) mid-reply, it has that reply followed; replies sent here are followed anyway.
 */
export function LiveRegion({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      const lastId = el ? store.getChat(chatId).messageIds.at(-1) : undefined;
      if (lastId) followReply(store, chatId, lastId);
    },
    [store, chatId],
  );
  return (
    <div ref={attach} aria-live="polite" aria-atomic="true" className="sr-only">
      {useAnnouncement(chatId)}
    </div>
  );
}
