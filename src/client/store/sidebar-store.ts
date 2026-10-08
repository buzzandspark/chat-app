"use client";
import { useState, useSyncExternalStore } from "react";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  groupId?: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  position: number;
  collapsed: boolean;
}

type Listener = () => void;

/** Chat list store so a first send updates the sidebar without a server round trip. */
class SidebarStore {
  private chats: ChatSummary[] = [];
  private groups: GroupSummary[] = [];
  private listeners = new Set<Listener>();

  get(): ChatSummary[] {
    return this.chats;
  }

  getGroups(): GroupSummary[] {
    return this.groups;
  }

  hydrateGroups(groups: GroupSummary[]): void {
    this.groups = [...groups].sort((a, b) => a.position - b.position);
    this.emit();
  }

  addGroup(group: GroupSummary): void {
    if (this.groups.some((g) => g.id === group.id)) return;
    this.groups = [...this.groups, group].sort((a, b) => a.position - b.position);
    this.emit();
  }

  patchGroup(id: string, fields: Partial<GroupSummary>): void {
    this.groups = this.groups.map((g) => (g.id === id ? { ...g, ...fields } : g)).sort((a, b) => a.position - b.position);
    this.emit();
  }

  /** The group goes; its chats stay and become ungrouped, as the server's foreign key does. */
  removeGroup(id: string): void {
    this.groups = this.groups.filter((g) => g.id !== id);
    this.chats = this.chats.map((c) => (c.groupId === id ? { ...c, groupId: null } : c));
    this.emit();
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

  upsert(chat: ChatSummary): void {
    const rest = this.chats.filter((c) => c.id !== chat.id);
    this.chats = [chat, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
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
const EMPTY_GROUPS: GroupSummary[] = [];
export function useSidebarGroups(initial?: GroupSummary[]): GroupSummary[] {
  const store = getSidebarStore();
  const [seededWith, setSeededWith] = useState<GroupSummary[] | null>(null);
  if (initial && seededWith !== initial) {
    store.hydrateGroups(initial);
    setSeededWith(initial);
  }
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getGroups(),
    () => initial ?? EMPTY_GROUPS,
  );
}

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
