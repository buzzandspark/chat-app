"use client";
import { createContext, useContext } from "react";
import type { ChatSettings } from "@client/store/chat-store";
import type { GenerationClient } from "@client/transport/generation-client";

export type { ChatSettings };

export interface EditingState {
  userMessageId: string;
  text: string;
}

/** Stable for the life of the view: callbacks and ids. Rows subscribe to this one (#43). */
export interface ChatActions {
  chatId: string;
  userId: string;
  client: GenerationClient;
  setSettings: (patch: Partial<ChatSettings>) => void;
  /** Also used by Continue after max_tokens. Only the composer passes `edit`; anything else cancels an open edit. */
  send: (text: string, scenario?: string, edit?: EditingState | null) => void;
  /** Regenerate from a user message, dropping that reply and everything after it. */
  retry: (userMessageId: string, fromMessageId: string) => void;
  /** D10: load a user message into the composer for editing. */
  editMessage: (userMessageId: string) => void;
  /** A queued message back into the composer (and out of the queue). */
  editQueued: (id: string) => void;
  removeQueued: (id: string) => void;
  cancelEdit: () => void;
  focusComposer: () => void;
  autoFollow: { engage: () => void; disengage: () => void };
  scenarioPanel: boolean;
}

/** Changes while the user works: settings, the edit in progress, whether the thread follows. Few consumers. */
export interface ChatLiveState {
  settings: ChatSettings;
  editing: EditingState | null;
  followEngaged: boolean;
}

export type ChatContextValue = ChatActions & ChatLiveState & { autoFollow: ChatActions["autoFollow"] & { engaged: boolean } };

export const ChatActionsContext = createContext<ChatActions | null>(null);
export const ChatLiveStateContext = createContext<ChatLiveState | null>(null);

export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext);
  if (!ctx) throw new Error("useChatActions outside ChatView");
  return ctx;
}

export function useChatLiveState(): ChatLiveState {
  const ctx = useContext(ChatLiveStateContext);
  if (!ctx) throw new Error("useChatLiveState outside ChatView");
  return ctx;
}

/** Both at once, for the composer, which needs everything and re-renders on every keystroke anyway. */
export function useChatContext(): ChatContextValue {
  const actions = useChatActions();
  const live = useChatLiveState();
  return { ...actions, ...live, autoFollow: { ...actions.autoFollow, engaged: live.followEngaged } };
}
