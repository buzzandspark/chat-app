"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, setPendingChat, type ChatSummary } from "@client/store/sidebar-store";
import { watchOptions } from "@client/store/forks";
import { readJson, type DeclareWinnerResponse, type DeleteForksResponse } from "@shared/api";
import { forkTabs } from "../chat/fork-tabs";
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

export function DeleteDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const newChat = useNewChat();
  const router = useRouter();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const store = useChatStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A main chat's forks outlive it (the server unlinks them), which the dialog says.
  const [forkCount] = useState(() => getSidebarStore().get().filter((c) => c.forkedFrom === chat.id).length);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) setError(`Delete failed (${res.status}). Try again.`);
      if (res.ok || res.status === 404) {
        const sidebar = getSidebarStore();
        // Deleting the open chat moves to the next tab over, as closing it does; a new chat when it has no tabs.
        const tabs = forkTabs(sidebar.get(), chat.id)?.tabs.filter((t) => !t.hidden).map((t) => t.id) ?? [];
        const at = tabs.indexOf(chat.id);
        const nextTab = at === -1 ? undefined : (tabs[at + 1] ?? tabs[at - 1]);
        for (const f of sidebar.get()) if (f.forkedFrom === chat.id) sidebar.patch(f.id, { forkedFrom: null });
        sidebar.remove(chat.id);
        // The hidden view (and a Back to its URL) shows an empty chat, not the deleted rows.
        store.removeChat(chat.id);
        if (currentChatId === chat.id) markNavigationClose();
        onOpenChange(false);
        if (currentChatId === chat.id) {
          if (nextTab) {
            setPendingChat(nextTab);
            router.push(`/c/${nextTab}`);
          } else newChat();
        }
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
      description={
        forkCount > 0
          ? `"${chat.title}" and its messages will be removed. This cannot be undone. Its ${forkCount === 1 ? "fork stays as a normal chat" : `${forkCount} forks stay as normal chats`}.`
          : `"${chat.title}" and its messages will be removed. This cannot be undone.`
      }
      // Opens on Delete, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        deleteRef.current?.focus();
      }}
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
        <Button ref={deleteRef} type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete
        </Button>
      </div>
    </ResponsiveDialog>
  );
}


/** The fork wins: it stays, with its history; the main chat and the other forks are deleted. */
export function DeclareWinnerDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const store = useChatStore();
  const declareRef = useRef<HTMLButtonElement>(null);
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
      const winner = await readJson<DeclareWinnerResponse>(res);
      const sidebar = getSidebarStore();
      for (const id of winner.deleted) {
        sidebar.remove(id);
        store.removeChat(id);
      }
      sidebar.patch(chat.id, { forkedFrom: null, forkOrder: null, tabHidden: false });
      store.setFork(chat.id, { from: null, position: null });
      // Haiku reads the winner's last reply now; its Explore button pops up when the count arrives, as after any reply.
      if (winner.lastMessageId) void watchOptions(store, winner.lastMessageId);
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
      // Opens on Declare winner, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        declareRef.current?.focus();
      }}
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
        <Button ref={declareRef} type="button" className="touch-target bg-warning text-white hover:bg-warning/85" disabled={busy} onClick={() => void confirm()}>
          Declare winner
        </Button>
      </div>
    </ResponsiveDialog>
  );
}


/** Every fork of the main chat is deleted; the main chat stays and is opened if a fork was being viewed. */
export function DeleteForksDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const store = useChatStore();
  const deleteRef = useRef<HTMLButtonElement>(null);
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
      const { deleted } = await readJson<DeleteForksResponse>(res);
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
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete all forks?"
      description={`Every fork of "${chat.title}" will be deleted; the main chat stays. This cannot be undone.`}
      // Opens on Delete, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        deleteRef.current?.focus();
      }}
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
        <Button ref={deleteRef} type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete forks
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

/** The sidebar's Delete group on a main chat with forks: the main chat and every fork go. */
export function DeleteAllDialog({ chat, currentChatId, open, onOpenChange }: DialogProps & { chat: ChatSummary; currentChatId: string | null }) {
  const store = useChatStore();
  const newChat = useNewChat();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/chats/${chat.id}/delete-all`, { method: "POST" });
      if (!res.ok && res.status !== 404) {
        setError(`Could not delete the chats (${res.status}).`);
        return;
      }
      const deleted = res.ok ? (await readJson<DeleteForksResponse>(res)).deleted : [chat.id];
      const sidebar = getSidebarStore();
      for (const id of deleted) {
        sidebar.remove(id);
        store.removeChat(id);
      }
      const leaving = currentChatId !== null && deleted.includes(currentChatId);
      if (leaving) markNavigationClose();
      onOpenChange(false);
      if (leaving) newChat();
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
      title="Delete group?"
      description={`"${chat.title}" and every fork of it will be removed, with their messages. This cannot be undone.`}
      // Opens on Delete, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        deleteRef.current?.focus();
      }}
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
        <Button ref={deleteRef} type="button" variant="destructive" className="touch-target" disabled={busy} onClick={() => void confirm()}>
          Delete group
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
