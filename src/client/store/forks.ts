"use client";
import { MAX_FORKS, type ForkOption, type OptionsEvent, type OptionsTrace } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import type { ChatStore } from "./chat-store";
import { prefetchChat } from "./prefetch";
import { getSidebarStore, setPendingChat } from "./sidebar-store";

export interface ForkOutcome {
  ok: boolean;
  error?: string;
}

const CAP = "You have reached your usage cap.";
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
  store.updateMessage(messageId, { options: [] });
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

export type RewriteOutcome = { ok: true; options: ForkOption[] } | { ok: false; error: string };

/** The sheet's instruction applied to every prompt; the call's trace goes to the console in development. */
export async function rewriteOptions(messageId: string, instruction: string, options: readonly ForkOption[]): Promise<RewriteOutcome> {
  const asked = performance.now();
  try {
    const res = await fetch(`/api/messages/${messageId}/options/rewrite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, options }),
    });
    if (!res.ok) return { ok: false, error: res.status === 402 ? CAP : `Could not apply the instruction (${res.status}).` };
    const data = (await res.json()) as { options: ForkOption[]; trace?: OptionsTrace | null };
    if (data.trace) logOptionsTrace("rewrite", data.trace, performance.now() - asked);
    return { ok: true, options: data.options };
  } catch {
    return { ok: false, error: "You seem to be offline." };
  }
}

/** A reply's options stream, one JSON object per line. */
export async function streamOptions(messageId: string, onEvent: (event: OptionsEvent) => void): Promise<void> {
  const res = await fetch(`/api/messages/${messageId}/options`);
  if (!res.ok || !res.body) throw new Error(`options request failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as OptionsEvent);
    }
  }
}

/** Follows a reply's options into the store: pending, then the count, then the final list; the trace goes to the console. */
export async function watchOptions(store: ChatStore, messageId: string): Promise<void> {
  const asked = performance.now();
  store.updateMessage(messageId, { optionsStream: { count: null, partial: [], failed: false } });
  // With a count of two or more the button stays and opens on what arrived; otherwise there is no button.
  const fail = () =>
    store.updateMessage(messageId, (m) => {
      const s = m.optionsStream;
      return s && s.count !== null && s.count >= 2 ? { optionsStream: { ...s, failed: true } } : { options: [], optionsStream: null };
    });
  try {
    await streamOptions(messageId, (event) => {
      if (event.done) {
        if (event.trace) logOptionsTrace("detect", event.trace, performance.now() - asked);
        store.updateMessage(messageId, { options: event.options ?? [], optionsStream: null });
      } else if (event.error) {
        fail();
      } else {
        store.updateMessage(messageId, (m) => {
          const s = m.optionsStream ?? { count: null, partial: [], failed: false };
          return { optionsStream: { ...s, count: event.count ?? s.count, partial: event.options ?? s.partial } };
        });
      }
    });
  } catch {
    fail();
    return;
  }
  const s = store.getMessage(messageId)?.optionsStream;
  if (s && !s.failed) fail();
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** The timing line: the page's wait, the Haiku call, the server's detection, the held request; whichever are known. */
export function traceTimings(trace: OptionsTrace, pageMs?: number): string {
  const parts: string[] = [];
  if (pageMs !== undefined) parts.push(`${seconds(pageMs)} in the page`);
  parts.push(`Haiku ${seconds(trace.apiMs)}`);
  if (trace.totalMs !== undefined) parts.push(`server ${seconds(trace.totalMs)}`);
  if (trace.waitedMs !== undefined) parts.push(`request held ${seconds(trace.waitedMs)}`);
  return parts.join(", ");
}

/** The Haiku call behind a reply's options (or a rewrite), as sent and answered, with its timings; development only. */
export function logOptionsTrace(kind: "detect" | "rewrite", trace: OptionsTrace, pageMs?: number): void {
  console.group(`[options] ${kind}: ${traceTimings(trace, pageMs)}`);
  console.log(`${trace.model}, stop ${trace.stopReason}, in ${trace.inputTokens} / out ${trace.outputTokens} tokens`);
  console.log(`system\n${trace.system}`);
  console.log(`user\n${trace.user}`);
  console.log("response", trace.response);
  console.groupEnd();
}
