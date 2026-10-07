"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageStateFromRow, textOf } from "@client/store/chat-store";
import { useChat, useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";
import type { MessageRow } from "@server/chats";
import { DEFAULT_MODEL } from "@shared/models";
import { ChatContext, type ChatSettings, type EditingState } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { LiveRegion } from "./live-region";
import { MessageList, type MessageListHandle } from "./message-list";

interface ChatViewProps {
  chatId: string;
  userId: string;
  title: string | null;
  updatedAt?: number;
  initialMessages: MessageRow[];
  isNew: boolean;
  scenarioPanel: boolean;
}

async function truncateOnServer(chatId: string, fromMessageId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${chatId}/truncate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fromMessageId }),
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export function ChatView({ chatId, userId, title, updatedAt, initialMessages, isNew, scenarioPanel }: ChatViewProps) {
  const store = useChatStore();
  const router = useRouter();
  const client = useMemo(() => getGenerationClient(store), [store]);
  // Seed the store during the first render so the first paint has the messages;
  // notifications are deferred so no ancestor subscriber is updated mid-render.
  const [hydratedFor] = useState(() => {
    store.hydrateChat(chatId, title, initialMessages.map(messageStateFromRow), { deferNotify: true });
    return chatId;
  });
  if (hydratedFor !== chatId) store.hydrateChat(chatId, title, initialMessages.map(messageStateFromRow), { deferNotify: true });

  const chat = useChat(chatId);
  const [settings, setSettingsState] = useState<ChatSettings>({ model: DEFAULT_MODEL, thinking: { harder: false }, scenario: null });
  const setSettings = useCallback((patch: Partial<ChatSettings>) => setSettingsState((s) => ({ ...s, ...patch })), []);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<MessageListHandle>(null);
  const [followEngaged, setFollowEngaged] = useState(true);
  const startedRef = useRef(!isNew);

  // A chat opened by navigation joins the sidebar list even if the layout rendered before it existed.
  useEffect(() => {
    if (!isNew && title) getSidebarStore().ensure({ id: chatId, title, updatedAt: updatedAt ?? 0 });
  }, [chatId, title, isNew, updatedAt]);

  // Desktop only (a phone would pop the keyboard): focus on a new chat, and after the
  // first send, when router.replace remounts this view under the chat's own URL.
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (min-width: 768px)").matches) return;
    const last = initialMessages.at(-1);
    if (!isNew && last?.status !== "streaming") return;
    const t = setTimeout(() => composerRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [isNew, chatId, initialMessages]);

  // D2: a reload mid-stream reattaches to the generation through the resume path.
  useEffect(() => {
    for (const row of initialMessages) {
      if (row.role === "assistant" && row.status === "streaming" && row.generationId) {
        client.attach(row.generationId, row.id);
      }
    }
  }, [client, initialMessages]);

  const announceChat = useCallback(
    (text: string) => {
      if (!startedRef.current) {
        startedRef.current = true;
        // Through the router, not history.replaceState: Next must know the route changed,
        // or a later navigation back to /c/new is a no-op that leaves this thread on screen.
        router.replace(`/c/${chatId}`, { scroll: false });
      }
      getSidebarStore().upsert({ id: chatId, title: chat.title ?? text.slice(0, 60), updatedAt: Date.now() });
      if (!chat.title) store.setChatTitle(chatId, text.slice(0, 60));
    },
    [chatId, chat.title, store, router],
  );

  const send = useCallback(
    (text: string, scenario?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const lastId = store.getChat(chatId).messageIds.at(-1);
      const last = lastId ? store.getMessage(lastId) : undefined;
      if (last?.role === "assistant" && last.status === "streaming") return;
      const opts = { chatId, model: settings.model, thinking: settings.thinking, scenario: scenario ?? settings.scenario ?? undefined };
      if (editing) {
        // D10: replace the edited user message and everything after it, then regenerate.
        const from = editing.userMessageId;
        setEditing(null);
        store.truncateFrom(from);
        void truncateOnServer(chatId, from).then(() => client.send({ ...opts, text: trimmed }));
      } else {
        client.send({ ...opts, text: trimmed });
      }
      listRef.current?.engage();
      announceChat(trimmed);
      composerRef.current?.focus();
    },
    [chatId, client, settings, editing, store, announceChat],
  );

  const retry = useCallback(
    (userMessageId: string, fromMessageId: string) => {
      store.truncateFrom(fromMessageId);
      void truncateOnServer(chatId, fromMessageId).then(() =>
        client.retry({ chatId, userMessageId, model: settings.model, thinking: settings.thinking, scenario: settings.scenario ?? undefined }),
      );
      listRef.current?.engage();
    },
    [chatId, client, settings, store],
  );

  const editMessage = useCallback(
    (userMessageId: string) => {
      const m = store.getMessage(userMessageId);
      if (!m) return;
      setEditing({ userMessageId, text: textOf(m.blocks) });
      composerRef.current?.focus();
    },
    [store],
  );

  const ctx = useMemo(
    () => ({
      chatId,
      userId,
      client,
      settings,
      setSettings,
      send,
      retry,
      editMessage,
      editing,
      cancelEdit: () => setEditing(null),
      focusComposer: () => composerRef.current?.focus(),
      autoFollow: { engaged: followEngaged, engage: () => listRef.current?.engage() },
      scenarioPanel,
    }),
    [chatId, userId, client, settings, setSettings, send, retry, editMessage, editing, followEngaged, scenarioPanel],
  );

  return (
    <ChatContext.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList ref={listRef} chatId={chatId} onFollowChange={setFollowEngaged} />
        <LiveRegion chatId={chatId} />
        <Composer ref={composerRef} chatId={chatId} />
      </div>
    </ChatContext.Provider>
  );
}
