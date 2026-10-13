"use client";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { watchOptions } from "@client/store/forks";
import { readJson, type DeclareWinnerResponse } from "@shared/api";
import { ConfirmDialog } from "./confirm-dialog";
import type { ChatDialogProps } from "./dialog-props";
import { useDropChats } from "./use-drop-chats";

/** The fork wins: it stays, with its history; the main chat and the other forks are deleted. */
export function DeclareWinnerDialog({ chat, currentChatId, open, onOpenChange }: ChatDialogProps) {
  const store = useChatStore();
  const dropChats = useDropChats(onOpenChange);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Declare the winner?"
      description={`"${chat.title}" stays, with its history, and can be forked again from here. The main chat and the other forks will be deleted. This can't be undone.`}
      label="Declare winner"
      tone="warning"
      onConfirm={async () => {
        if (!chat.forkedFrom) return null;
        const res = await fetch(`/api/chats/${chat.id}/declare-winner`, { method: "POST" });
        if (!res.ok) return res.status === 404 ? "This chat is no longer a fork." : "Couldn't declare the winner. Try again.";
        const winner = await readJson<DeclareWinnerResponse>(res);
        getSidebarStore().patch(chat.id, { forkedFrom: null, forkOrder: null, tabHidden: false });
        store.setFork(chat.id, { from: null, position: null });
        // Haiku reads the winner's last reply now; its Explore button pops up when the count arrives, as after any reply.
        if (winner.lastMessageId) void watchOptions(store, winner.lastMessageId);
        dropChats(winner.deleted, currentChatId, chat.id);
        return null;
      }}
    />
  );
}
