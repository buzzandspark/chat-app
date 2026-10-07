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
}

/**
 * ADR-0005: the server's rows reconcile into the store during render (so a hard load paints them in
 * its first frame) and render nothing. Notifications are deferred so no ancestor updates mid-render.
 */
export function SeedChat({ chatId, title, updatedAt, rows }: SeedChatProps) {
  const store = useChatStore();
  const client = useMemo(() => getGenerationClient(store), [store]);
  const [applied, setApplied] = useState<SeedRow[] | null>(null);
  if (applied !== rows) {
    store.seedChat(chatId, title, rows, { deferNotify: true });
    setApplied(rows);
  }
  useEffect(() => {
    // A chat opened by deep link joins the sidebar even if the layout rendered before it existed.
    if (title) getSidebarStore().ensure({ id: chatId, title, updatedAt: updatedAt ?? 0 });
    // D2: a reply still streaming on the server reattaches through the resume path.
    for (const row of rows) {
      if (row.role === "assistant" && row.status === "streaming" && row.generationId) client.attach(row.generationId, row.id);
    }
  }, [chatId, title, updatedAt, rows, client]);
  return null;
}
