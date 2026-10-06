"use client";
import { createContext, useContext } from "react";
import type { GenerationClient } from "@client/transport/generation-client";
import type { ModelId, ThinkingOptions } from "@shared/types";

export interface ChatSettings {
  model: ModelId;
  thinking: ThinkingOptions;
  scenario: string | null;
}

export interface ChatContextValue {
  chatId: string;
  client: GenerationClient;
  settings: ChatSettings;
  setSettings: (patch: Partial<ChatSettings>) => void;
  /** Send a new user turn (used by Continue after max_tokens and by the composer). */
  send: (text: string, scenario?: string) => void;
  retry: (userMessageId: string, fromMessageId: string) => void;
  focusComposer: () => void;
  autoFollow: { engaged: boolean; engage: () => void };
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext outside ChatView");
  return ctx;
}
