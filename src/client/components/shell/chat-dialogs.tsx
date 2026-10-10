"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, setPendingChat, type ChatSummary } from "@client/store/sidebar-store";
import type { ForkOption } from "@shared/forks";
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
        const sidebar = getSidebarStore();
        for (const f of sidebar.get()) if (f.forkedFrom === chat.id) sidebar.patch(f.id, { forkedFrom: null });
        sidebar.remove(chat.id);
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


/** The fork wins: it stays, with its history; the main chat and the other forks are deleted. */
export function DeclareWinnerDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const store = useChatStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy || !chat.forkedFrom) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chat.id}/declare-winner`, { method: "POST" });
      if (!res.ok) {
        setError(res.status === 404 ? "This chat is no longer a fork." : `Could not declare the winner (${res.status}).`);
        return;
      }
      const winner = (await res.json()) as { id: string; deleted: string[]; lastMessageId: string | null };
      const sidebar = getSidebarStore();
      for (const id of winner.deleted) {
        sidebar.remove(id);
        store.removeChat(id);
      }
      sidebar.patch(chat.id, { forkedFrom: null, forkOrder: null, tabHidden: false });
      store.setFork(chat.id, { from: null, position: null });
      // Haiku reads the winner's last reply now; waiting for it here means the chat opens with its button.
      if (winner.lastMessageId) {
        const found = await fetch(`/api/messages/${winner.lastMessageId}/options`).then((r) => (r.ok ? (r.json() as Promise<{ options: ForkOption[] | null }>) : null)).catch(() => null);
        if (found?.options) store.updateMessage(winner.lastMessageId, { options: found.options });
      }
      const leaving = currentChatId !== null && winner.deleted.includes(currentChatId);
      if (leaving) markNavigationClose();
      onOpenChange(false);
      if (leaving) {
        setPendingChat(chat.id);
        router.push(`/c/${chat.id}`);
      }
    } catch {
      setError("You seem to be offline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Declare the winner?"
      description={`"${chat.title}" stays, with its history, and can be forked again from here. The main chat and the other forks will be deleted. This cannot be undone.`}
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
          Declare winner
        </Button>
      </div>
    </ResponsiveDialog>
  );
}


/** Every fork of the main chat is deleted; the main chat stays and is opened if a fork was being viewed. */
export function DeleteForksDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const store = useChatStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chat.id}/delete-forks`, { method: "POST" });
      if (!res.ok) {
        setError(res.status === 404 ? "This chat no longer exists." : `Could not delete the forks (${res.status}).`);
        return;
      }
      const { deleted } = (await res.json()) as { deleted: string[] };
      const sidebar = getSidebarStore();
      for (const id of deleted) {
        sidebar.remove(id);
        store.removeChat(id);
      }
      const leaving = currentChatId !== null && deleted.includes(currentChatId);
      if (leaving) markNavigationClose();
      onOpenChange(false);
      if (leaving) {
        setPendingChat(chat.id);
        router.push(`/c/${chat.id}`);
      }
    } catch {
      setError("You seem to be offline.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Delete all forks?" description={`Every fork of "${chat.title}" will be deleted; the main chat stays. This cannot be undone.`}>
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
          Delete forks
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
