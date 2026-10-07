"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { ResponsiveDialog } from "../ui/responsive-dialog";

export function RenameDialog({ chat, onClose }: { chat: ChatSummary | null; onClose: () => void }) {
  const store = useChatStore();
  const [value, setValue] = useState(chat?.title ?? "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastChat, setLastChat] = useState(chat);
  if (chat !== lastChat) {
    setLastChat(chat);
    setValue(chat?.title ?? "");
  }
  useEffect(() => {
    if (chat) setTimeout(() => inputRef.current?.select(), 50);
  }, [chat]);

  const submit = async () => {
    if (!chat || !value.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value.trim() }),
      });
      if (res.ok) {
        getSidebarStore().upsert({ ...chat, title: value.trim(), updatedAt: Date.now() });
        store.setChatTitle(chat.id, value.trim());
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={chat !== null} onOpenChange={(o) => !o && onClose()} title="Rename chat">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Chat title" maxLength={120} className="h-11 text-body" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="touch-target" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="touch-target" disabled={!value.trim() || busy}>
            Save
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

export function DeleteDialog({ chat, onClose, currentChatId }: { chat: ChatSummary | null; onClose: () => void; currentChatId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!chat || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (res.ok) {
        getSidebarStore().remove(chat.id);
        onClose();
        if (currentChatId === chat.id) router.push("/c/new");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={chat !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Delete chat?"
      description={chat ? `"${chat.title}" and its messages will be removed. This cannot be undone.` : undefined}
    >
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="touch-target" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
