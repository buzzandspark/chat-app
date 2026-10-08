"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, type ChatSummary, type GroupSummary } from "@client/store/sidebar-store";
import { ResponsiveDialog } from "../ui/responsive-dialog";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameDialog({ chat, open, onOpenChange }: DialogProps & { chat: ChatSummary }) {
  const store = useChatStore();
  const [value, setValue] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      } else setError(res.status === 404 ? "This chat no longer exists." : `Rename failed (${res.status}). Try again.`);
    } catch {
      setError("Rename failed: you seem to be offline.");
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

export function DeleteDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const newChat = useNewChat();
  const store = useChatStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) setError(`Delete failed (${res.status}). Try again.`);
      if (res.ok || res.status === 404) {
        getSidebarStore().remove(chat.id);
        // The hidden view (and a Back to its URL) shows an empty chat, not the deleted rows.
        store.removeChat(chat.id);
        if (currentChatId === chat.id) markNavigationClose();
        onOpenChange(false);
        if (currentChatId === chat.id) newChat();
      }
    } catch {
      setError("Delete failed: you seem to be offline.");
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
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
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

/** Name for a new group, or a new name for an existing one. */
export function GroupNameDialog({
  initial = "",
  title,
  open,
  onOpenChange,
  onSubmit,
}: DialogProps & { initial?: string; title: string; onSubmit: (name: string) => Promise<boolean> }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.select(), 50);
    return () => clearTimeout(t);
  }, []);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await onSubmit(value.trim())) onOpenChange(false);
      else setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Group name" maxLength={60} className="h-11 text-body" />
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

/** Deleting a group keeps its chats; they return to the main list. */
export function DeleteGroupDialog({ group, open, onOpenChange }: DialogProps & { group: GroupSummary }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        getSidebarStore().removeGroup(group.id);
        onOpenChange(false);
      } else setError(`Delete failed (${res.status}). Try again.`);
    } catch {
      setError("Delete failed: you seem to be offline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Delete group" description={`"${group.name}" goes away; its chats stay and return to the main list.`}>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete group
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
