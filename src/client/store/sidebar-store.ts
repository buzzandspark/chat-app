"use client";
import { useState, useSyncExternalStore } from "react";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
}

type Listener = () => void;

/** Chat list store so a first send updates the sidebar without a server round trip. */
export class SidebarStore {
  private chats: ChatSummary[] = [];
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

  hydrate(chats: ChatSummary[]): void {
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

  /**
   * Inserts a new chat, or merges into the known one: a send names only id, title and updatedAt, and
   * replacing the entry would drop `pinned`, moving the row out of its section until a reload.
   * Clearing it goes through `patch`, never through here.
   */
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
async function patchChat(id: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pin: the row moves at once and the server is told; a refused or failed request (offline included)
 * puts the flag back, unless the user has changed it again since, so a late failure cannot undo a
 * newer change that the server did take.
 */
export async function patchChatOptimistic(store: SidebarStore, id: string, fields: { pinned: boolean }): Promise<boolean> {
  // An absent `pinned` reads as unpinned, as the sidebar renders it.
  const read = () => Boolean(store.get().find((x) => x.id === id)?.pinned);
  const before = read();
  store.patch(id, fields);
  const ok = await patchChat(id, fields);
  if (!ok && read() === fields.pinned) store.patch(id, { pinned: before });
  return ok;
}

const EMPTY: ChatSummary[] = [];
let singleton: SidebarStore | null = null;
export function getSidebarStore(): SidebarStore {
  singleton ??= new SidebarStore();
  return singleton;
}

/**
 * `initial` is the server's list: it is the server snapshot, so SSR and hydration render the real rows
 * (no "No chats yet." flash, no shift), and it seeds the store on the first client render.
 */
export function useSidebarChats(initial?: ChatSummary[]): ChatSummary[] {
  const store = getSidebarStore();
  const [seededWith, setSeededWith] = useState<ChatSummary[] | null>(null);
  if (initial && seededWith !== initial) {
    store.hydrate(initial);
    setSeededWith(initial);
  }
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => initial ?? EMPTY,
  );
}

// The chat the user just asked for, before the router has committed the navigation: the sidebar row
// highlights and the header title switches on click, not when the thread arrives (D21).
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
