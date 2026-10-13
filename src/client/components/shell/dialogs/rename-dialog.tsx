"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { ResponsiveDialog } from "@client/components/ui/responsive-dialog";
import type { DialogProps } from "./dialog-props";

const OFFLINE = "You're offline. Try again when you're connected.";

export function RenameDialog({ chat, open, onOpenChange }: DialogProps & { chat: ChatSummary }) {
  const store = useChatStore();
  const [value, setValue] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      } else setError(res.status === 404 ? "This chat no longer exists." : "Couldn't rename the chat. Try again.");
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename chat"
      // The whole title selected on open, ready to be typed over.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Chat title" maxLength={120} className="h-11 text-body" />
        {error ? (
          <p role="alert" className="text-small text-destructive">
            {error}
          </p>
        ) : null}
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
