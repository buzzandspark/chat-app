"use client";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { saveLastChoice } from "@client/hooks/use-last-choice";
import { useNewChat } from "@client/hooks/use-new-chat";
import { textOf, type ChatSettings } from "@client/store/chat-store";
import { ensureMarkdown, useMarkdownReady } from "@client/markdown/ready";
import { useChat, useChatSeeded, useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";
import { isUuid } from "@shared/id";
import { isModelId } from "@shared/models";
import { ChatActionsContext, ChatLiveStateContext, type EditingState } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { LiveRegion } from "./live-region";
import { MessageList, type MessageListHandle } from "./message-list";
import { useShellUser } from "../shell/shell-user";
import { ThreadSkeleton } from "./thread-skeleton";

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
  // The callbacks read the current settings through a ref, so they stay stable while the user changes them (#43).
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const setSettings = useCallback(
    (patch: Partial<ChatSettings>) => {
      store.setSettings(chatId, patch);
      if (patch.model !== undefined || patch.thinking !== undefined) {
        const next = store.getChat(chatId).settings;
        saveLastChoice(userId, { model: next.model, thinking: next.thinking });
      }
    },
    [store, chatId, userId],
  );
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

  // The URL already is this chat's own, so a send only has to name it. The header title is local
  // and immediate; the sidebar row waits until the server has accepted the generation, so a refused
  // or lost first POST leaves no ghost entry behind.
  const announceChat = useCallback(
    (text: string) => {
      const title = chat.title ?? text.slice(0, 60);
      if (!chat.title) store.setChatTitle(chatId, title);
      return () => getSidebarStore().upsert({ id: chatId, title, updatedAt: Date.now() });
    },
    [chatId, chat.title, store],
  );

  // `edit` is explicit (#36): only the composer's own submit replaces a message. Continue and a
  // scenario pick while an edit is open leave the edited turns alone and cancel the edit instead.
  const send = useCallback(
    (text: string, scenario?: string, edit: EditingState | null = null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const lastId = store.getChat(chatId).messageIds.at(-1);
      const last = lastId ? store.getMessage(lastId) : undefined;
      if (last?.role === "assistant" && last.status === "streaming") return;
      const current = settingsRef.current;
      const opts = { chatId, model: current.model, thinking: current.thinking, scenario: scenario ?? current.scenario?.name };
      const hooks = { onAccepted: announceChat(trimmed) };
      // The reply will need the Markdown renderer's chunk; fetch it while the request is in flight.
      void ensureMarkdown();
      if (edit) {
        // D10: replace the edited user message and everything after it in the same request (#21).
        store.truncateFrom(edit.userMessageId);
        client.send({ ...opts, text: trimmed, replaceFrom: edit.userMessageId }, hooks);
      } else {
        client.send({ ...opts, text: trimmed }, hooks);
      }
      setEditing(null);
      listRef.current?.engage();
      // Only where a keyboard is physical: on a phone, focusing pops the keyboard over the reply (#32).
      if (window.matchMedia("(hover: hover) and (min-width: 768px)").matches) composerRef.current?.focus();
    },
    [chatId, client, store, announceChat],
  );

  const retry = useCallback(
    (userMessageId: string, fromMessageId: string) => {
      // The text travels with the retry: after a refused first POST the server has no user row to retry from.
      const text = textOf(store.getMessage(userMessageId)?.blocks ?? []) || undefined;
      // The replaced reply's own model and scenario, not whatever the picker shows now.
      const replaced = store.getMessage(fromMessageId);
      const current = settingsRef.current;
      const model = isModelId(replaced?.requestedModel) ? replaced.requestedModel : current.model;
      const scenario = replaced?.scenario ?? current.scenario?.name;
      store.truncateFrom(fromMessageId);
      // A retry after a refused first send is the chat's first accepted generation: list it then.
      client.retry(
        { chatId, userMessageId, text, model, thinking: current.thinking, scenario, replaceFrom: fromMessageId },
        { onAccepted: announceChat(text ?? "") },
      );
      listRef.current?.engage();
    },
    [chatId, client, store, announceChat],
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

  const actions = useMemo(
    () => ({
      chatId,
      userId,
      client,
      setSettings,
      send,
      retry,
      editMessage,
      cancelEdit: () => setEditing(null),
      focusComposer: () => composerRef.current?.focus(),
      autoFollow: { engage: () => listRef.current?.engage(), disengage: () => listRef.current?.disengage() },
      scenarioPanel,
    }),
    [chatId, userId, client, setSettings, send, retry, editMessage, scenarioPanel],
  );
  const live = useMemo(() => ({ settings, editing, followEngaged }), [settings, editing, followEngaged]);

  if (!isUuid(chatId)) return <MissingChat />;

  return (
    <ChatActionsContext.Provider value={actions}>
      <ChatLiveStateContext.Provider value={live}>
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
          <Thread chatId={chatId} listRef={listRef} onFollowChange={setFollowEngaged} />
          <LiveRegion chatId={chatId} />
          <Composer ref={composerRef} chatId={chatId} />
        </div>
      </ChatLiveStateContext.Provider>
    </ChatActionsContext.Provider>
  );
}

/**
 * The skeleton stands in until the chat is seeded and, for a chat with rows, until the Markdown chunk is
 * in (#83): rows that paint with empty bodies and fill in later would shift everything below them.
 */
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
  const chat = useChat(chatId);
  const markdownReady = useMarkdownReady();
  if (!seeded || (chat.messageIds.length > 0 && !markdownReady)) return <ThreadSkeleton />;
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
