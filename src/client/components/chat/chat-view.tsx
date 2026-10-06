"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChatStore, messageStateFromRow } from "@client/store/chat-store";
import { useChat } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";
import type { MessageRow } from "@server/chats";
import { DEFAULT_MODEL } from "@shared/models";
import { ChatContext, type ChatSettings } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { MessageList, type MessageListHandle } from "./message-list";
import { ScenarioPanel } from "./scenario-panel";

interface ChatViewProps {
  chatId: string;
  title: string | null;
  initialMessages: MessageRow[];
  isNew: boolean;
  scenarioPanel: boolean;
}

export function ChatView({ chatId, title, initialMessages, isNew, scenarioPanel }: ChatViewProps) {
  const store = getChatStore();
  const client = useMemo(() => getGenerationClient(store), [store]);
  // Seed the external store before the first subscription so the first paint has the messages.
  const [hydratedFor] = useState(() => {
    store.hydrateChat(chatId, title, initialMessages.map(messageStateFromRow));
    return chatId;
  });
  if (hydratedFor !== chatId) store.hydrateChat(chatId, title, initialMessages.map(messageStateFromRow));

  const chat = useChat(chatId);
  const [settings, setSettingsState] = useState<ChatSettings>({ model: DEFAULT_MODEL, thinking: { harder: false }, scenario: null });
  const setSettings = useCallback((patch: Partial<ChatSettings>) => setSettingsState((s) => ({ ...s, ...patch })), []);
  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<MessageListHandle>(null);
  const [followEngaged, setFollowEngaged] = useState(true);
  const startedRef = useRef(!isNew);

  // D2: a reload mid-stream reattaches to the generation through the resume path.
  useEffect(() => {
    for (const row of initialMessages) {
      if (row.role === "assistant" && row.status === "streaming" && row.generationId) {
        client.attach(row.generationId, row.id);
      }
    }
  }, [client, initialMessages]);

  const send = useCallback(
    (text: string, scenario?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      client.send({ chatId, text: trimmed, model: settings.model, thinking: settings.thinking, scenario: scenario ?? settings.scenario ?? undefined });
      listRef.current?.engage();
      if (!startedRef.current) {
        startedRef.current = true;
        window.history.replaceState(null, "", `/c/${chatId}`);
      }
      getSidebarStore().upsert({ id: chatId, title: chat.title ?? trimmed.slice(0, 60), updatedAt: Date.now() });
      if (!chat.title) store.setChatTitle(chatId, trimmed.slice(0, 60));
      composerRef.current?.focus();
    },
    [chatId, client, settings, chat.title, store],
  );

  const retry = useCallback(
    (userMessageId: string, fromMessageId: string) => {
      store.truncateFrom(fromMessageId);
      client.retry({ chatId, userMessageId, model: settings.model, thinking: settings.thinking, scenario: settings.scenario ?? undefined });
      listRef.current?.engage();
    },
    [chatId, client, settings, store],
  );

  const ctx = useMemo(
    () => ({
      chatId,
      client,
      settings,
      setSettings,
      send,
      retry,
      focusComposer: () => composerRef.current?.focus(),
      autoFollow: { engaged: followEngaged, engage: () => listRef.current?.engage() },
    }),
    [chatId, client, settings, setSettings, send, retry, followEngaged],
  );

  return (
    <ChatContext.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageList ref={listRef} chatId={chatId} onFollowChange={setFollowEngaged} />
        {scenarioPanel ? <ScenarioPanel /> : null}
        <Composer ref={composerRef} chatId={chatId} />
      </div>
    </ChatContext.Provider>
  );
}
