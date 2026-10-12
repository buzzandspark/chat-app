"use client";
import type { ChatSettings } from "@client/store/chat-store";
import { isModelId } from "@shared/models";

const PREFIX = "chat:settings:";

type Choice = Pick<ChatSettings, "model" | "thinking">;

/** The model and effort last chosen by this user, so a new chat starts where the previous one left off. */
export function readLastChoice(userId: string): Partial<Choice> {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { model?: unknown; thinking?: { harder?: unknown } };
    const out: Partial<Choice> = {};
    if (isModelId(parsed.model)) out.model = parsed.model;
    if (typeof parsed.thinking?.harder === "boolean") out.thinking = { harder: parsed.thinking.harder };
    return out;
  } catch {
    return {};
  }
}

export function saveLastChoice(userId: string, choice: Choice): void {
  try {
    localStorage.setItem(PREFIX + userId, JSON.stringify(choice));
  } catch {
    // storage unavailable
  }
}
