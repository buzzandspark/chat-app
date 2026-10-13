"use client";
import { readJson, type DeleteForksResponse } from "@shared/api";
import { ConfirmDialog } from "./confirm-dialog";
import type { ChatDialogProps } from "./dialog-props";
import { useDropChats } from "./use-drop-chats";

/** Every fork of the main chat is deleted; the main chat stays and is opened if a fork was being viewed. */
export function DeleteForksDialog({ chat, currentChatId, open, onOpenChange }: ChatDialogProps) {
  const dropChats = useDropChats(onOpenChange);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete all forks?"
      description={`Every fork of "${chat.title}" will be deleted; the main chat stays. This can't be undone.`}
      label="Delete forks"
      tone="destructive"
      onConfirm={async () => {
        const res = await fetch(`/api/chats/${chat.id}/delete-forks`, { method: "POST" });
        if (!res.ok) return res.status === 404 ? "This chat no longer exists." : "Couldn't delete the forks. Try again.";
        const { deleted } = await readJson<DeleteForksResponse>(res);
        dropChats(deleted, currentChatId, chat.id);
        return null;
      }}
    />
  );
}
