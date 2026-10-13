"use client";
import { readJson, type DeleteForksResponse } from "@shared/api";
import { ConfirmDialog } from "./confirm-dialog";
import type { ChatDialogProps } from "./dialog-props";
import { useDropChats } from "./use-drop-chats";

/** The sidebar's Delete chat and forks on a main chat with forks: the main chat and every fork go. */
export function DeleteAllDialog({ chat, currentChatId, open, onOpenChange }: ChatDialogProps) {
  const dropChats = useDropChats(onOpenChange);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete chat and forks?"
      description={`"${chat.title}" and every fork of it will be deleted, with their messages. This can't be undone.`}
      label="Delete chat and forks"
      tone="destructive"
      onConfirm={async () => {
        const res = await fetch(`/api/chats/${chat.id}/delete-all`, { method: "POST" });
        if (!res.ok && res.status !== 404) return "Couldn't delete the chat and its forks. Try again.";
        const deleted = res.ok ? (await readJson<DeleteForksResponse>(res)).deleted : [chat.id];
        dropChats(deleted, currentChatId, null);
        return null;
      }}
    />
  );
}
