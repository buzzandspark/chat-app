"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { ResponsiveDialog } from "../ui/responsive-dialog";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameDialog({ chat, open, onOpenChange }: DialogProps & { chat: ChatSummary }) {
  const store = useChatStore();
  const [value, setValue] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.select(), 50);
    return () => clearTimeout(t);
  }, []);

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value.trim() }),
      });
      if (res.ok) {
        getSidebarStore().patch(chat.id, { title: value.trim() });
        store.setChatTitle(chat.id, value.trim());
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Rename chat">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Chat title" maxLength={120} className="h-11 text-body" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
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

export function DeleteDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (res.ok) {
        getSidebarStore().remove(chat.id);
        onOpenChange(false);
        if (currentChatId === chat.id) router.push("/c/new");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete chat?"
      description={`"${chat.title}" and its messages will be removed. This cannot be undone.`}
    >
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
