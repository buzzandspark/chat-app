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
import { forkTabs } from "../../chat/fork-tabs";
import { ResponsiveDialog } from "../../ui/responsive-dialog";

const OFFLINE = "You're offline. Try again when you're connected.";

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

/** Removes the chats from the sidebar and the store; when the open chat was one, opens `fallback` (a new chat when null). */
function useDropChats(onOpenChange: (open: boolean) => void) {
  const store = useChatStore();
  const router = useRouter();
  const newChat = useNewChat();
  return (ids: string[], currentChatId: string | null, fallback: string | null) => {
    const sidebar = getSidebarStore();
    for (const id of ids) {
      sidebar.remove(id);
      // The hidden view (and a Back to its URL) shows an empty chat, not the deleted rows.
      store.removeChat(id);
    }
    const leaving = currentChatId !== null && ids.includes(currentChatId);
    if (leaving) markNavigationClose();
    onOpenChange(false);
    if (!leaving) return;
    if (fallback) {
      setPendingChat(fallback);
      router.push(`/c/${fallback}`);
    } else newChat();
  };
}

interface ConfirmDialogProps extends DialogProps {
  title: string;
  description: string;
  label: string;
  tone: "destructive" | "warning";
  /** Resolves to the error to show, or null once done. */
  onConfirm: () => Promise<string | null>;
}

function ConfirmDialog({ open, onOpenChange, title, description, label, tone, onConfirm }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await onConfirm());
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
      title={title}
      description={description}
      // Opens on the confirm button, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        confirmRef.current?.focus();
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
        <Button
          ref={confirmRef}
          type="button"
          variant={tone === "destructive" ? "destructive" : "default"}
          className={tone === "warning" ? "touch-target bg-warning text-white hover:bg-warning/85" : "touch-target"}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {label}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

export type ChatDialogProps = DialogProps & { chat: ChatSummary; currentChatId: string | null };

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
