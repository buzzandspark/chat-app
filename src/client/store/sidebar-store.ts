"use client";
import { useSyncExternalStore } from "react";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
}

type Listener = () => void;

/** Small external store for the chat list so a first send updates the sidebar without a server round trip. */
class SidebarStore {
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

export function useSidebarChats(): ChatSummary[] {
  const store = getSidebarStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => EMPTY,
  );
}
