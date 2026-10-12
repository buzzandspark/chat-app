"use client";
import type { OptionsEvent, OptionsTrace } from "@shared/forks";
import type { ChatStore } from "./chat-store";

export const CAP = "You have reached your usage cap.";

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
      // A fork from a list still arriving spent the options; the rest of the stream is ignored.
      if (!store.getMessage(messageId)?.optionsStream) return;
      if (event.done) {
        if (process.env.NODE_ENV !== "production" && event.trace) logOptionsTrace("detect", event.trace, performance.now() - asked);
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
