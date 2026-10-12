"use client";
import { MAX_FORKS, type ForkOption } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import type { ChatStore } from "./chat-store";
import { CAP } from "./forks";
import { prefetchChat } from "./prefetch";
import { getSidebarStore, setPendingChat } from "./sidebar-store";

// Loaded with the fork sheet or a reply's menu, not the chat route: nothing forks before one of those is open.

export interface ForkOutcome {
  ok: boolean;
  error?: string;
}

const MESSAGES: Record<number, string> = {
  402: CAP,
  404: "This chat no longer exists.",
  409: "This chat cannot be forked.",
  503: "The server is restarting; try again in a moment.",
};

/** Forks the chat once per option, lists the forks, seeds them (attaching to their replies) and opens the first. */
export async function forkChat(
  store: ChatStore,
  router: { push: (href: string) => void },
  chatId: string,
  messageId: string,
  options: readonly ForkOption[],
  /** Just before the forks are listed, which is when the tab strip appears. */
  onListed?: () => void,
): Promise<ForkOutcome> {
  const forks = options.slice(0, MAX_FORKS).map((o) => ({
    chatId: uuidv7(),
    generationId: uuidv7(),
    userMessageId: uuidv7(),
    assistantMessageId: uuidv7(),
    title: o.title,
    prompt: o.prompt,
  }));
  let res: Response;
  try {
    res = await fetch(`/api/chats/${chatId}/fork`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forks }) });
  } catch {
    return { ok: false, error: "You seem to be offline." };
  }
  if (!res.ok) return { ok: false, error: MESSAGES[res.status] ?? `Forking failed (${res.status}). Try again.` };
  const data = (await res.json()) as { forks: { chatId: string }[]; failed?: { error: string } };
  const first = data.forks[0];
  if (!first) return { ok: false, error: "No fork could be started." };
  store.updateMessage(messageId, { options: [], optionsStream: null });
  onListed?.();
  const sidebar = getSidebarStore();
  const existing = sidebar.get().filter((c) => c.forkedFrom === chatId).length;
  const now = Date.now();
  data.forks.forEach((f, i) => {
    const o = forks.find((x) => x.chatId === f.chatId);
    if (o) sidebar.upsert({ id: f.chatId, title: o.title, updatedAt: now, forkedFrom: chatId, forkOrder: existing + i });
  });
  await prefetchChat(store, first.chatId);
  for (const f of data.forks.slice(1)) void prefetchChat(store, f.chatId);
  setPendingChat(first.chatId);
  router.push(`/c/${first.chatId}`);
  if (data.failed) return { ok: true, error: data.failed.error === "quota_exceeded" ? CAP : "Some forks could not start." };
  return { ok: true };
}

/** A reply's "Duplicate": a new fork tab holding the chat up to that reply, listed and opened. */
export async function duplicateChat(store: ChatStore, router: { push: (href: string) => void }, chatId: string, messageId: string): Promise<ForkOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/chats/${chatId}/duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: uuidv7(), messageId }),
    });
  } catch {
    return { ok: false, error: "You seem to be offline." };
  }
  if (res.status === 409) return { ok: false, error: `This chat already has ${MAX_FORKS} forks.` };
  if (!res.ok) return { ok: false, error: MESSAGES[res.status] ?? `Duplicating failed (${res.status}). Try again.` };
  const dup = (await res.json()) as { chatId: string; parentId: string; title: string; forkOrder: number };
  getSidebarStore().upsert({ id: dup.chatId, title: dup.title, updatedAt: Date.now(), forkedFrom: dup.parentId, forkOrder: dup.forkOrder });
  await prefetchChat(store, dup.chatId);
  setPendingChat(dup.chatId);
  router.push(`/c/${dup.chatId}`);
  return { ok: true };
}

