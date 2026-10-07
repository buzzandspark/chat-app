"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useNewChat } from "@client/hooks/use-new-chat";
import { textOf, type ChatSettings } from "@client/store/chat-store";
import { useChat, useChatSeeded, useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";
import { isUuid } from "@shared/id";
import { isModelId } from "@shared/models";
import { ChatContext, type EditingState } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { LiveRegion } from "./live-region";
import { MessageList, type MessageListHandle } from "./message-list";
import { useShellUser } from "../shell/shell-user";
import { ThreadSkeleton } from "./thread-skeleton";

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

/**
 * ADR-0005: the view renders from the client store at once; the id comes from the URL and the
 * server's rows arrive through `children` (a Suspense child that seeds the store) whenever they do.
 */
export function ChatView({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  // One instance per URL; a hidden instance must not follow the active chat's params.
  const [chatId] = useState(params.id);
  const { userId, scenarioPanel } = useShellUser();
  const store = useChatStore();
  const client = useMemo(() => getGenerationClient(store), [store]);
  const chat = useChat(chatId);
  const settings = chat.settings;
  const setSettings = useCallback((patch: Partial<ChatSettings>) => store.setSettings(chatId, patch), [store, chatId]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<MessageListHandle>(null);
  const [followEngaged, setFollowEngaged] = useState(true);
  const isEmpty = chat.seeded && chat.messageIds.length === 0;

  // Desktop only (a phone would pop the keyboard): focus the composer on a new chat.
  useEffect(() => {
    if (!isEmpty || !window.matchMedia("(hover: hover) and (min-width: 768px)").matches) return;
    const t = setTimeout(() => composerRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [isEmpty, chatId]);

  // The URL already is this chat's own, so a send only has to name it in the sidebar.
  const announceChat = useCallback(
    (text: string) => {
      getSidebarStore().upsert({ id: chatId, title: chat.title ?? text.slice(0, 60), updatedAt: Date.now() });
      if (!chat.title) store.setChatTitle(chatId, text.slice(0, 60));
    },
    [chatId, chat.title, store],
  );

  const send = useCallback(
    (text: string, scenario?: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const lastId = store.getChat(chatId).messageIds.at(-1);
      const last = lastId ? store.getMessage(lastId) : undefined;
      if (last?.role === "assistant" && last.status === "streaming") return;
      const opts = { chatId, model: settings.model, thinking: settings.thinking, scenario: scenario ?? settings.scenario?.name };
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
      // The text travels with the retry: after a refused first POST the server has no user row to retry from.
      const text = textOf(store.getMessage(userMessageId)?.blocks ?? []) || undefined;
      // The replaced reply's own model and scenario, not whatever the picker shows now.
      const replaced = store.getMessage(fromMessageId);
      const model = isModelId(replaced?.requestedModel) ? replaced.requestedModel : settings.model;
      const scenario = replaced?.scenario ?? settings.scenario?.name;
      store.truncateFrom(fromMessageId);
      void truncateOnServer(chatId, fromMessageId).then(() =>
        client.retry({ chatId, userMessageId, text, model, thinking: settings.thinking, scenario }),
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

  if (!isUuid(chatId)) return <MissingChat />;

  return (
    <ChatContext.Provider value={ctx}>
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
        <Thread chatId={chatId} listRef={listRef} onFollowChange={setFollowEngaged} />
        <LiveRegion chatId={chatId} />
        <Composer ref={composerRef} chatId={chatId} />
      </div>
    </ChatContext.Provider>
  );
}

/** The skeleton stands in only until the chat is seeded; the composer around it is the real one. */
function Thread({
  chatId,
  listRef,
  onFollowChange,
}: {
  chatId: string;
  listRef: RefObject<MessageListHandle | null>;
  onFollowChange: (engaged: boolean) => void;
}) {
  const seeded = useChatSeeded(chatId);
  if (!seeded) return <ThreadSkeleton />;
  return <MessageList ref={listRef} chatId={chatId} onFollowChange={onFollowChange} />;
}

function MissingChat() {
  const newChat = useNewChat();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-gutter text-center">
      <p className="text-body text-muted-foreground">This chat link is not valid.</p>
      <Button variant="outline" className="touch-target" onClick={newChat}>
        New chat
      </Button>
    </div>
  );
}
