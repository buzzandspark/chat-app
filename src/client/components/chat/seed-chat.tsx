"use client";
import { useEffect, useMemo, useState } from "react";
import type { SeedRow } from "@client/store/chat-store";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";

interface SeedChatProps {
  chatId: string;
  title: string | null;
  updatedAt: number | null;
  rows: SeedRow[];
  /** Messages before the window the server sent; the list offers to load them. */
  older?: number;
  forkedFrom?: string | null;
  forkPosition?: number | null;
}

/**
 * ADR-0005: the server's rows reconcile into the store during render (so a hard load paints them in
 * its first frame) and render nothing. Notifications are deferred so no ancestor updates mid-render.
 */
export function SeedChat({ chatId, title, updatedAt, rows, older = 0, forkedFrom = null, forkPosition = null }: SeedChatProps) {
  const store = useChatStore();
  const client = useMemo(() => getGenerationClient(store), [store]);
  const [applied, setApplied] = useState<SeedRow[] | null>(null);
  // Re-applied when the rows change and when the store has since evicted this chat.
  if (applied !== rows || !store.getChat(chatId).seeded) {
    store.seedChat(chatId, title, rows, { deferNotify: true, older, fork: { from: forkedFrom, position: forkPosition } });
    setApplied(rows);
  }
  useEffect(() => {
    if (store.isRemoved(chatId)) return;
    // A chat opened by deep link joins the sidebar even if the layout rendered before it existed.
    if (title) getSidebarStore().ensure({ id: chatId, title, updatedAt: updatedAt ?? 0, forkedFrom });
    // A reply still streaming on the server reattaches through the resume path.
    for (const row of rows) {
      if (row.role === "assistant" && row.status === "streaming" && row.generationId) client.attach(row.generationId, row.id);
    }
  }, [chatId, title, updatedAt, rows, store, client, forkedFrom]);
  return null;
}
