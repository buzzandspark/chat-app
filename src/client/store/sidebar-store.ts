"use client";
import { useState, useSyncExternalStore } from "react";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  forkedFrom?: string | null;
  forkOrder?: number | null;
  tabHidden?: boolean;
}

type Listener = () => void;

/** Chat list store so a first send updates the sidebar without a server round trip. */
export class SidebarStore {
  private chats: ChatSummary[] = [];
  private userId: string | null = null;
  private listeners = new Set<Listener>();

  get(): ChatSummary[] {
    return this.chats;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Keeps local rows the server list doesn't have yet, but only for the same user: a sign-in as someone else starts over. */
  hydrate(chats: ChatSummary[], userId: string): void {
    if (userId !== this.userId) {
      this.userId = userId;
      this.chats = [];
    }
    const known = new Map(this.chats.map((c) => [c.id, c]));
    const merged = chats.map((c) => {
      const local = known.get(c.id);
      return local && local.updatedAt > c.updatedAt ? local : c;
    });
    for (const c of this.chats) if (!chats.some((x) => x.id === c.id)) merged.push(c);
    merged.sort((a, b) => b.updatedAt - a.updatedAt);
    this.chats = merged;
    this.emit();
  }

  /** Adds a chat the list does not know yet, without reordering anything (opening is not activity). */
  ensure(chat: ChatSummary): void {
    if (this.chats.some((c) => c.id === chat.id)) return;
    this.chats = [...this.chats, chat].sort((a, b) => b.updatedAt - a.updatedAt);
    this.emit();
  }

  /** Updates fields in place; only a changed `updatedAt` moves a chat. */
  patch(id: string, fields: Partial<ChatSummary>): void {
    this.chats = this.chats.map((c) => (c.id === id ? { ...c, ...fields } : c)).sort((a, b) => b.updatedAt - a.updatedAt);
    this.emit();
  }

  /** Merges rather than replaces: a send names only id, title and updatedAt, and replacing would drop `pinned`. */
  upsert(chat: ChatSummary): void {
    const existing = this.chats.find((c) => c.id === chat.id);
    const rest = existing ? this.chats.filter((c) => c !== existing) : this.chats;
    this.chats = [existing ? { ...existing, ...chat } : chat, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
    this.emit();
  }

  remove(id: string): void {
    this.chats = this.chats.filter((c) => c.id !== id);
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** PATCHes a chat; a refusal and a network failure both come back as false, never as a rejection. */
export async function patchChat(id: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Optimistic; a failure puts the flag back only if the user has not changed it since, so it cannot undo a newer change. */
export async function patchChatOptimistic(store: SidebarStore, id: string, fields: { pinned: boolean }): Promise<boolean> {
  // An absent `pinned` reads as unpinned, as the sidebar renders it.
  const read = () => Boolean(store.get().find((x) => x.id === id)?.pinned);
  const before = read();
  store.patch(id, fields);
  const ok = await patchChat(id, fields);
  if (!ok && read() === fields.pinned) store.patch(id, { pinned: before });
  return ok;
}

/** A tab closed or reopened: the strip changes at once; a refused request puts it back. */
export async function setTabHidden(store: SidebarStore, id: string, hidden: boolean): Promise<boolean> {
  store.patch(id, { tabHidden: hidden });
  const ok = await patchChat(id, { tabHidden: hidden });
  if (!ok) store.patch(id, { tabHidden: !hidden });
  return ok;
}

const EMPTY: ChatSummary[] = [];
let singleton: SidebarStore | null = null;
export function getSidebarStore(): SidebarStore {
  singleton ??= new SidebarStore();
  return singleton;
}

/** `initial` is the server snapshot, so SSR and hydration render the real rows with no empty-state flash. */
export function useSidebarChats(initial?: { chats: ChatSummary[]; userId: string }): ChatSummary[] {
  const store = getSidebarStore();
  const [seededWith, setSeededWith] = useState<ChatSummary[] | null>(null);
  // On the server the singleton is shared by every request, so only the snapshot below may carry the rows.
  if (initial && seededWith !== initial.chats && typeof window !== "undefined") {
    store.hydrate(initial.chats, initial.userId);
    setSeededWith(initial.chats);
  }
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => initial?.chats ?? EMPTY,
  );
}

// The chat the user just asked for, before the router commits, so the row and title switch on click.
let pending: string | null = null;
const listeners = new Set<() => void>();

export function setPendingChat(id: string | null): void {
  if (pending === id) return;
  pending = id;
  for (const l of listeners) l();
}

export function usePendingChat(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => pending,
    () => null,
  );
}
