"use client";
import type { ForkRequest } from "@relay/forks";
import { busyText } from "@client/components/chat/rate-limit";
import { readJson, type ApiError, type DuplicateResponse, type ForkResponse } from "@shared/api";
import { MAX_FORKS, type ForkOption } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import type { ChatStore } from "./chat-store";
import { CAP } from "./forks";
import { prefetchChat } from "./prefetch";
import { getSidebarStore, setPendingChat } from "./sidebar-store";

// Loaded with the fork sheet or a reply's menu, not the chat route.

export interface ForkOutcome {
  ok: boolean;
  error?: string;
}

const OFFLINE = "You're offline. Try again when you're connected.";

/** Each reply's last unanswered or refused Explore: sending the same options again reuses its ids, so the route answers a retry with the forks it already started. */
const attempts = new Map<string, { key: string; forks: ForkRequest[] }>();

function forkRequests(messageId: string, options: readonly ForkOption[]): ForkRequest[] {
  const chosen = options.slice(0, MAX_FORKS);
  const key = JSON.stringify(chosen.map((o) => [o.title, o.prompt]));
  const kept = attempts.get(messageId);
  if (kept?.key === key) return kept.forks;
  const forks = chosen.map((o) => ({
    chatId: uuidv7(),
    generationId: uuidv7(),
    userMessageId: uuidv7(),
    assistantMessageId: uuidv7(),
    title: o.title,
    prompt: o.prompt,
  }));
  attempts.set(messageId, { key, forks });
  return forks;
}

/** A refused fork, in words: the route's 409 carries why in its error code. */
async function refusal(res: Response): Promise<string> {
  if (res.status === 402) return CAP;
  if (res.status === 429) return busyText(Number(res.headers.get("retry-after")) * 1000);
  if (res.status === 403) return "Guests can't fork chats right now. Sign in to continue.";
  if (res.status === 404) return "This chat no longer exists.";
  if (res.status === 503) return "The server is restarting. Try again in a moment.";
  if (res.status === 409) {
    const body: Partial<ApiError> = await readJson<ApiError>(res).catch(() => ({}));
    if (body.error === "too_many") return `This chat already has ${MAX_FORKS} forks.`;
    if (body.error === "is_fork") return "A fork can't be forked again.";
    if (body.error === "spent") return "These options were already explored.";
    if (body.error === "stale") return "This reply is no longer the latest one.";
  }
  return "Couldn't fork this chat. Try again.";
}

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
  const forks = forkRequests(messageId, options);
  let res: Response;
  try {
    res = await fetch(`/api/chats/${chatId}/fork`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId, forks }) });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  if (!res.ok) return { ok: false, error: await refusal(res) };
  const data = await readJson<ForkResponse>(res);
  const first = data.forks[0];
  if (!first) return { ok: false, error: "Couldn't start the forks. Try again." };
  attempts.delete(messageId);
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
  if (data.failed) return { ok: true, error: data.failed.error === "quota_exceeded" ? CAP : data.failed.error === "rate_limited" ? busyText(data.failed.retryAfterMs ?? 0) : "Some forks couldn't start." };
  return { ok: true };
}

/** A reply's "Copy from here": a new fork tab holding the chat up to that reply, listed and opened. */
export async function duplicateChat(store: ChatStore, router: { push: (href: string) => void }, chatId: string, messageId: string): Promise<ForkOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/chats/${chatId}/duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: uuidv7(), messageId }),
    });
  } catch {
    return { ok: false, error: OFFLINE };
  }
  if (!res.ok) return { ok: false, error: await refusal(res) };
  const dup = await readJson<DuplicateResponse>(res);
  getSidebarStore().upsert({ id: dup.chatId, title: dup.title, updatedAt: Date.now(), forkedFrom: dup.parentId, forkOrder: dup.forkOrder });
  await prefetchChat(store, dup.chatId);
  setPendingChat(dup.chatId);
  router.push(`/c/${dup.chatId}`);
  return { ok: true };
}

