"use client";
import { useState } from "react";
import { forkTabs } from "@client/store/forks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { ConfirmDialog } from "./confirm-dialog";
import type { ChatDialogProps } from "./dialog-props";
import { useDropChats } from "./use-drop-chats";

export function DeleteDialog({ chat, currentChatId, open, onOpenChange }: ChatDialogProps) {
  const dropChats = useDropChats(onOpenChange);
  // A main chat's forks outlive it (the server unlinks them), which the dialog says.
  const [forkCount] = useState(() => getSidebarStore().get().filter((c) => c.forkedFrom === chat.id).length);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete chat?"
      description={
        forkCount > 0
          ? `"${chat.title}" and its messages will be deleted. This can't be undone. Its ${forkCount === 1 ? "fork stays as a normal chat" : `${forkCount} forks stay as normal chats`}.`
          : `"${chat.title}" and its messages will be deleted. This can't be undone.`
      }
      label="Delete"
      tone="destructive"
      onConfirm={async () => {
        const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) return "Couldn't delete the chat. Try again.";
        const sidebar = getSidebarStore();
        // Deleting the open chat moves to the next tab over, as closing it does; a new chat when it has no tabs.
        const tabs = forkTabs(sidebar.get(), chat.id)?.tabs.filter((t) => !t.hidden).map((t) => t.id) ?? [];
        const at = tabs.indexOf(chat.id);
        const nextTab = at === -1 ? undefined : (tabs[at + 1] ?? tabs[at - 1]);
        for (const f of sidebar.get()) if (f.forkedFrom === chat.id) sidebar.patch(f.id, { forkedFrom: null });
        dropChats([chat.id], currentChatId, nextTab ?? null);
        return null;
      }}
    />
  );
}
