"use client";
import { createContext, useContext } from "react";
import type { ChatSettings } from "@client/store/chat-store";
import type { GenerationClient } from "@client/transport/generation-client";

export type { ChatSettings };

export interface EditingState {
  userMessageId: string;
  text: string;
}

export interface ChatContextValue {
  chatId: string;
  userId: string;
  client: GenerationClient;
  settings: ChatSettings;
  setSettings: (patch: Partial<ChatSettings>) => void;
  /** Also used by Continue after max_tokens. */
  send: (text: string, scenario?: string) => void;
  /** Regenerate from a user message, dropping that reply and everything after it. */
  retry: (userMessageId: string, fromMessageId: string) => void;
  /** D10: load a user message into the composer for editing. */
  editMessage: (userMessageId: string) => void;
  editing: EditingState | null;
  cancelEdit: () => void;
  focusComposer: () => void;
  autoFollow: { engaged: boolean; engage: () => void };
  scenarioPanel: boolean;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext outside ChatView");
  return ctx;
}
