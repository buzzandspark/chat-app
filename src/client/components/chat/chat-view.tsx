"use client";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { saveLastChoice } from "@client/hooks/use-last-choice";
import { useNewChat } from "@client/hooks/use-new-chat";
import { canRetryReply, textOf, type ChatSettings } from "@client/store/chat-store";
import { ensureMarkdown, useMarkdownFailed, useMarkdownReady } from "@client/markdown/ready";
import { useChat, useChatSeeded, useChatStore } from "@client/store/hooks";
import { getSidebarStore } from "@client/store/sidebar-store";
import { getGenerationClient } from "@client/transport/generation-client";
import { GUEST_MODEL } from "@shared/models";
import { isUuid, uuidv7 } from "@shared/id";
import { isModelId } from "@shared/models";
import { ChatActionsContext, ChatLiveStateContext, type EditingState } from "./chat-context";
import { Composer, type ComposerHandle } from "./composer";
import { LiveRegion } from "./live-region";
import { ForkTabs } from "./fork-tabs";
import { MessageList, type MessageListHandle } from "./message-list";
import { useShellUser } from "../shell/shell-user";
import { EmptyThread, ThreadSkeleton } from "./thread-skeleton";

/** ADR-0005: renders from the client store at once; the server's rows arrive through `children`, a Suspense child that seeds the store. */
export function ChatView({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const search = useSearchParams();
  const pathname = usePathname();
  // At /c the id is in-app New chat's `n`, or a fresh one. The router keeps a single /c view across search
  // params and restores it for every New chat, so a new `n` moves that view to the new chat. Hidden views
  // read the active route's params, so which route this view belongs to is fixed at mount.
  const fromNew = search.get("n");
  // A first send renames /c to /c/<id> on the /c route (no `id` param); Back restores that entry into this view.
  const fromPath = params.id === undefined ? /^\/c\/([^/]+)$/.exec(pathname)?.[1] : undefined;
  const target = fromPath ?? fromNew;
  const [atNewChat] = useState(() => params.id === undefined);
  const [chatId, setChatId] = useState(() => params.id ?? (target && isUuid(target) ? target : uuidv7()));
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [followEngaged, setFollowEngaged] = useState(true);
  if (atNewChat && target && isUuid(target) && target !== chatId) {
    setChatId(target);
    setEditing(null);
    setFollowEngaged(true);
  }
  const newChatRoute = params.id === undefined;
  const { userId, guest, scenarioPanel } = useShellUser();
  const store = useChatStore();
  const client = useMemo(() => getGenerationClient(store), [store]);
  const chat = useChat(chatId);
  const settings = chat.settings;
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
  const composerRef = useRef<ComposerHandle>(null);
  const listRef = useRef<MessageListHandle>(null);
  const isEmpty = chat.seeded && chat.messageIds.length === 0;

  // Desktop only (a phone would pop the keyboard): focus the composer on a new chat.
  useEffect(() => {
    if (!isEmpty || !window.matchMedia("(hover: hover) and (min-width: 768px)").matches) return;
    const t = setTimeout(() => composerRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [isEmpty, chatId]);

  // The header title updates immediately; the sidebar row waits until the server accepts the generation,
  // so a refused or lost first POST leaves no ghost entry.
  const announceChat = useCallback(
    (text: string) => {
      const title = chat.title ?? text.slice(0, 60);
      if (!chat.title) store.setChatTitle(chatId, title);
      return () => getSidebarStore().upsert({ id: chatId, title, updatedAt: Date.now() });
    },
    [chatId, chat.title, store],
  );

  // Only the composer's own submit replaces a message; Continue and a scenario pick cancel an open edit instead.
  const dispatch = useCallback(
    (text: string, scenario?: string, edit: EditingState | null = null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Read from the store when called, so the callbacks stay stable while the user changes settings.
      const current = store.getChat(chatId).settings;
      const opts = { chatId, model: current.model, thinking: current.thinking, scenario: scenario ?? current.scenario?.name };
      const hooks = { onAccepted: announceChat(trimmed) };
      // The reply will need the Markdown renderer's chunk; fetch it while the request is in flight.
      void ensureMarkdown();
      // The first send names the chat in the address (/c becomes /c/<id>, nothing remounted) before sending, so the live region follows the reply.
      // State null: Next's patched replaceState then copies its own and syncs usePathname (passing its state skips that).
      if (newChatRoute && window.location.pathname === "/c") window.history.replaceState(null, "", `/c/${chatId}`);
      if (edit) {
        // Replace the edited user message and everything after it in the same request.
        store.truncateFrom(edit.userMessageId);
        client.send({ ...opts, text: trimmed, replaceFrom: edit.userMessageId }, hooks);
      } else {
        client.send({ ...opts, text: trimmed }, hooks);
      }
      setEditing(null);
      listRef.current?.engage();
      // Only with a physical keyboard: on a phone, focusing pops the keyboard over the reply.
      if (window.matchMedia("(hover: hover) and (min-width: 768px)").matches) composerRef.current?.focus();
    },
    [chatId, client, store, announceChat, newChatRoute],
  );

  // A message sent while a reply streams joins the chat's queue. An edit can't be queued (it would replace
  // turns still being written), so it is ignored while a reply streams.
  const send = useCallback(
    (text: string, scenario?: string, edit: EditingState | null = null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const lastId = store.getChat(chatId).messageIds.at(-1);
      const last = lastId ? store.getMessage(lastId) : undefined;
      if (last?.role === "assistant" && last.status === "streaming") {
        if (edit) return;
        store.enqueueMessage(chatId, { id: uuidv7(), text: trimmed, scenario: scenario ?? store.getChat(chatId).settings.scenario?.name ?? null });
        listRef.current?.engage();
        return;
      }
      // A queue a failed reply left behind goes first, so messages keep the order they were written in.
      const held = edit ? undefined : store.takeQueued(chatId);
      if (held) {
        store.enqueueMessage(chatId, { id: uuidv7(), text: trimmed, scenario: scenario ?? store.getChat(chatId).settings.scenario?.name ?? null });
        dispatch(held.text, held.scenario ?? undefined);
        return;
      }
      dispatch(trimmed, scenario, edit);
    },
    [chatId, store, dispatch],
  );

  const editQueued = useCallback(
    (id: string) => {
      const item = store.removeQueued(chatId, id);
      if (!item) return;
      setEditing(null);
      composerRef.current?.setValue(item.text);
      composerRef.current?.focus();
    },
    [chatId, store],
  );
  const removeQueued = useCallback((id: string) => void store.removeQueued(chatId, id), [chatId, store]);

  const retry = useCallback(
    (userMessageId: string, fromMessageId: string) => {
      const replaced = store.getMessage(fromMessageId);
      // Checked against the store, not the render that scheduled it: a 429 timer can fire after a send
      // has already put a newer turn behind the reply, and a reply that is gone was retried already.
      if (!replaced || !canRetryReply(store.getChat(chatId), replaced)) return;
      // The text travels with the retry: after a refused first POST the server has no user row to retry from.
      const text = textOf(store.getMessage(userMessageId)?.blocks ?? []) || undefined;
      // The replaced reply's own model and scenario, not whatever the picker shows now.
      const current = store.getChat(chatId).settings;
      const model = isModelId(replaced.requestedModel) ? replaced.requestedModel : current.model;
      const scenario = replaced.scenario ?? current.scenario?.name;
      // A retry of a rate-limited reply continues its streak, so the next wait doubles; anything else starts at 0.
      const attempt = replaced.status === "error" && replaced.error?.kind === "rate_limited" ? replaced.retryAttempt + 1 : 0;
      // Usually the reply itself; for a refused Edit or Regenerate, the turns that attempt was to
      // replace, which the server still has while this view already dropped them.
      const replaceFrom = client.retryReplaceFrom(replaced);
      store.truncateFrom(fromMessageId);
      // A retry after a refused first send is the chat's first accepted generation: list it then.
      client.retry(
        { chatId, userMessageId, text, model, thinking: current.thinking, scenario, replaceFrom, attempt },
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
      editQueued,
      removeQueued,
      cancelEdit: () => setEditing(null),
      focusComposer: () => composerRef.current?.focus(),
      autoFollow: { engage: () => listRef.current?.engage(), disengage: () => listRef.current?.disengage() },
      scenarioPanel,
    }),
    [chatId, userId, client, setSettings, send, retry, editMessage, editQueued, removeQueued, scenarioPanel],
  );
  // A guest's picker always reads Haiku, even in a chat whose replies were on another model (the server runs Haiku).
  const live = useMemo(
    () => ({ settings: guest && settings.model !== GUEST_MODEL ? { ...settings, model: GUEST_MODEL } : settings, editing, followEngaged }),
    [guest, settings, editing, followEngaged],
  );

  if (!isUuid(chatId)) return <MissingChat />;

  return (
    <ChatActionsContext.Provider value={actions}>
      <ChatLiveStateContext.Provider value={live}>
        <div key={chatId} className="group/chat flex min-h-0 flex-1 flex-col">
          {children}
          <ForkTabs chatId={chatId} />
          <Thread chatId={chatId} newChat={newChatRoute} listRef={listRef} onFollowChange={setFollowEngaged} />
          <LiveRegion chatId={chatId} />
          <Composer ref={composerRef} chatId={chatId} draftId={newChatRoute && chat.messageIds.length === 0 ? "new" : chatId} />
        </div>
      </ChatLiveStateContext.Provider>
    </ChatActionsContext.Provider>
  );
}

/**
 * Waits for the seed and, for a chat with rows, the Markdown chunk: bodies filling in later would shift rows below.
 * An empty seed or a failed chunk doesn't wait; rows show plain text until the renderer arrives. A new chat
 * has nothing to wait for, so its server HTML already shows the empty state (the page's LCP).
 */
function Thread({
  chatId,
  newChat,
  listRef,
  onFollowChange,
}: {
  chatId: string;
  newChat: boolean;
  listRef: RefObject<MessageListHandle | null>;
  onFollowChange: (engaged: boolean) => void;
}) {
  const seeded = useChatSeeded(chatId);
  const chat = useChat(chatId);
  const markdownReady = useMarkdownReady();
  const markdownFailed = useMarkdownFailed();
  // Decided once, when the chat is first seeded here.
  const [seededEmpty, setSeededEmpty] = useState<boolean | null>(null);
  if (seeded && seededEmpty === null) setSeededEmpty(chat.messageIds.length === 0);
  const waitForMarkdown = chat.messageIds.length > 0 && !markdownReady && !markdownFailed && !seededEmpty;
  if (!seeded && newChat) return <EmptyThread />;
  if (!seeded || waitForMarkdown) return <ThreadSkeleton />;
  return <MessageList ref={listRef} chatId={chatId} onFollowChange={onFollowChange} />;
}

function MissingChat() {
  const newChat = useNewChat();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-gutter text-center">
      <p className="text-body text-muted-foreground">This chat link isn&apos;t valid.</p>
      <Button variant="outline" className="touch-target" onClick={newChat}>
        New chat
      </Button>
    </div>
  );
}
